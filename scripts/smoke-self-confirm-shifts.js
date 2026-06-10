/**
 * Smoke test: manager publish → staff self-confirm → cross-user 403
 * Run: node scripts/smoke-self-confirm-shifts.js
 */
require('dotenv').config({ path: '.env.local' });

const BASE = process.env.API_BASE || 'http://127.0.0.1:3000/api';

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Login ${email}: ${body.message}`);
  const token = body.token || body.data?.token;
  if (!token) throw new Error(`Login ${email}: no token in response`);
  return token;
}

async function api(method, path, token, payload) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function futureDate(days = 5) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loginOtherNurse(managerToken, nurseAProfileId) {
  const staffRes = await api('GET', '/staff?role=nurse&limit=50', managerToken);
  const list = staffRes.body.data || [];
  const other = list.find(
    (u) => u.staffProfile?._id && String(u.staffProfile._id) !== String(nurseAProfileId)
  );
  if (!other?.email) throw new Error('No second nurse for cross-user test');
  const email = other.email;
  try {
    return await login(email, 'password123');
  } catch {
    return login(email, 'Password123!');
  }
}

async function createPublishedShift(managerToken, template, nurseAProfileId) {
  for (let offset = 5; offset <= 45; offset += 1) {
    const workDate = futureDate(offset);
    const create = await api('POST', '/shifts', managerToken, {
      shiftTemplateId: template._id,
      workDate,
      assignedStaffId: nurseAProfileId,
      taskDescription: 'Smoke self-confirm',
    });
    if (create.status !== 201) continue;
    const shiftId = create.body.shift?._id || create.body.data?.shift?._id;
    if (!shiftId) continue;
    const publish = await api('PUT', `/shifts/${shiftId}/publish`, managerToken);
    if (publish.status !== 200) continue;
    return { shiftId, workDate };
  }
  throw new Error('Could not create and publish a shift on any candidate date');
}

async function main() {
  const managerToken = await login('manager@test.com', 'password123');
  const nurseAToken = await login('nurse@test.com', 'password123');

  const templates = await api('GET', '/shift-templates', managerToken);
  const templateList = templates.body.data?.data || templates.body.data || [];
  const template = templateList.find((t) => t.shiftCode === 'DAY') || templateList[0];
  if (!template) throw new Error('No shift template');

  const staffRes = await api('GET', '/staff?role=nurse&limit=50', managerToken);
  const list = staffRes.body.data || [];
  const nurseAUser = list.find((u) => u.email === 'nurse@test.com' || u.staffProfile?.staffCode === 'NUR003');
  const nurseAProfileId = nurseAUser?.staffProfile?._id;
  if (!nurseAProfileId) throw new Error('Nurse A profile not found');

  const { shiftId, workDate } = await createPublishedShift(managerToken, template, nurseAProfileId);
  console.log('Smoke: staff self-confirm shifts, workDate =', workDate);

  const managerConfirm = await api('PUT', `/shifts/${shiftId}/confirm`, managerToken);
  if (managerConfirm.status !== 403) {
    throw new Error(`Manager confirm should be 403, got ${managerConfirm.status}`);
  }
  console.log('OK: manager blocked from confirming shift');

  const myShifts = await api(
    'GET',
    `/shifts/my?status=published&fromDate=${workDate}&toDate=${workDate}`,
    nurseAToken
  );
  if (myShifts.status !== 200) throw new Error(`GET /shifts/my failed: ${myShifts.status}`);
  const myList = myShifts.body.data?.data || myShifts.body.data || [];
  if (!myList.some((s) => s._id === shiftId)) {
    throw new Error('Nurse A does not see published shift in /my');
  }

  const confirm = await api('PUT', `/shifts/${shiftId}/confirm`, nurseAToken);
  if (confirm.status !== 200) {
    throw new Error(`Confirm failed: ${confirm.status} ${confirm.body.message}`);
  }
  const confirmedStatus = confirm.body.data?.status;
  if (confirmedStatus && confirmedStatus !== 'confirmed') {
    throw new Error('Expected confirmed status');
  }

  const nurseBOther = await loginOtherNurse(managerToken, nurseAProfileId);
  const cross = await api('PUT', `/shifts/${shiftId}/confirm`, nurseBOther);
  if (cross.status !== 400 && cross.status !== 403) {
    throw new Error(`Expected 403/400 for cross-user confirm, got ${cross.status}`);
  }

  const managerGet = await api('GET', `/shifts/${shiftId}`, managerToken);
  if (managerGet.status !== 200) throw new Error('Manager should still view shift');

  console.log('PASS: publish → nurse A /my → confirm → cross-user blocked');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  if (err.cause) console.error('cause:', err.cause);
  process.exit(1);
});

/**
 * Smoke test: care task assignee roles (nurse/doctor only) + status ownership
 * Run: node scripts/smoke-care-task-roles.js
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
  if (!token) throw new Error(`Login ${email}: no token`);
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

function futureDate(days = 7) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const unwrapList = (body) => {
  const payload = body?.data;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

async function ensurePublishedShift(managerToken, staffProfileId, workDate) {
  const shiftsRes = await api(
    'GET',
    `/shifts?fromDate=${workDate}&toDate=${workDate}&assignedStaffId=${staffProfileId}&limit=50`,
    managerToken
  );
  const shifts = unwrapList(shiftsRes.body);
  let shift = shifts.find((s) => ['published', 'confirmed'].includes(s.status));
  if (shift) return shift;

  const templates = await api('GET', '/shift-templates', managerToken);
  const templateList = templates.body.data?.data || templates.body.data || [];
  const template = templateList.find((t) => t.shiftCode === 'DAY') || templateList[0];
  if (!template?._id) throw new Error('No shift template for smoke');

  const createShift = await api('POST', '/shifts', managerToken, {
    shiftTemplateId: template._id,
    workDate,
    assignedStaffId: staffProfileId,
    taskDescription: 'Smoke care task roles',
  });
  if (createShift.status !== 201) {
    throw new Error(`Create shift: ${createShift.status} ${createShift.body.message}`);
  }
  shift = createShift.body.shift || createShift.body.data;
  const publish = await api('PUT', `/shifts/${shift._id}/publish`, managerToken);
  if (publish.status !== 200) {
    throw new Error(`Publish shift: ${publish.status} ${publish.body.message}`);
  }
  return shift;
}

async function main() {
  const workDate = futureDate(7);
  console.log('Smoke: care task roles, workDate =', workDate);

  const managerToken = await login('manager@test.com', 'password123');
  const doctorToken = await login('doctor@test.com', 'password123');
  let caregiverToken;
  try {
    caregiverToken = await login('caregiver@test.com', 'password123');
  } catch {
    caregiverToken = await login('caregiver@seed.com', 'password123');
  }

  const staffRes = await api('GET', '/staff?limit=100', managerToken);
  const staffList = staffRes.body.data || [];
  const doctor = staffList.find((u) => u.email === 'doctor@test.com');
  const caregiver = staffList.find(
    (u) => u.email === 'caregiver@test.com' || u.email === 'caregiver@seed.com'
  );
  if (!doctor?.staffProfile?._id) throw new Error('doctor@test.com profile not found');
  if (!caregiver?.staffProfile?._id) throw new Error('caregiver profile not found');

  const ctx = await api('GET', `/staff/care-tasks/assignment-context?workDate=${workDate}`, managerToken);
  if (ctx.status !== 200) throw new Error(`assignment-context: ${ctx.status} ${ctx.body.message}`);
  const staffWithShifts = ctx.body.data?.staffWithShifts || [];
  const doctorInCtx = staffWithShifts.find(
    (s) => String(s.staffProfileId) === String(doctor.staffProfile._id)
  );
  if (!doctorInCtx) {
    console.log('Doctor not in context (no shift yet) — creating shift...');
  }

  const shift = await ensurePublishedShift(managerToken, doctor.staffProfile._id, workDate);
  const scheduledTime = shift.startTime || '09:00';

  const assignedRes = await api('GET', `/staff/${doctor._id}/residents/assigned`, managerToken);
  const residents = unwrapList(assignedRes.body);
  if (!residents.length) throw new Error('Doctor has no assigned residents');
  const residentId = residents[0]._id;

  const assignPayload = {
    staffProfileId: doctor.staffProfile._id,
    residentId,
    shiftId: shift._id,
    taskType: 'morning_care',
    careLevel: 'low',
    workDate,
    scheduledTime,
  };

  const createDoctor = await api('POST', '/staff/care-tasks', managerToken, assignPayload);
  if (createDoctor.status !== 201) {
    throw new Error(`Assign to doctor should be 201, got ${createDoctor.status} ${createDoctor.body.message}`);
  }
  console.log('OK: manager assigns care task to doctor');

  const createCaregiver = await api('POST', '/staff/care-tasks', managerToken, {
    ...assignPayload,
    staffProfileId: caregiver.staffProfile._id,
  });
  if (createCaregiver.status !== 400) {
    throw new Error(`Assign to caregiver should be 400, got ${createCaregiver.status}`);
  }
  console.log('OK: caregiver assignee rejected');

  const taskId = createDoctor.body.data?.task?._id || createDoctor.body.data?._id;
  if (!taskId) throw new Error('No task id from create response');

  const managerInProgress = await api('PUT', `/staff/care-tasks/${taskId}/status`, managerToken, {
    status: 'in_progress',
  });
  if (managerInProgress.status !== 403) {
    throw new Error(`Manager in_progress should be 403, got ${managerInProgress.status}`);
  }
  console.log('OK: manager blocked from in_progress');

  const doctorInProgress = await api('PUT', `/caregiver/care-tasks/${taskId}/status`, doctorToken, {
    status: 'in_progress',
  });
  if (doctorInProgress.status !== 200) {
    throw new Error(`Doctor in_progress should be 200, got ${doctorInProgress.status} ${doctorInProgress.body.message}`);
  }
  console.log('OK: doctor can set in_progress');

  const createSkip = await api('POST', '/staff/care-tasks', managerToken, {
    ...assignPayload,
    taskType: 'evening_check',
    scheduledTime: shift.endTime && shift.endTime > scheduledTime ? shift.endTime : '17:00',
  });
  if (createSkip.status !== 201) {
    throw new Error(`Second task for skip test: ${createSkip.status} ${createSkip.body.message}`);
  }
  const skipTaskId = createSkip.body.data?.task?._id || createSkip.body.data?._id;

  const managerSkip = await api('PUT', `/staff/care-tasks/${skipTaskId}/status`, managerToken, {
    status: 'skipped',
  });
  if (managerSkip.status !== 200) {
    throw new Error(`Manager skip should be 200, got ${managerSkip.status} ${managerSkip.body.message}`);
  }
  console.log('OK: manager can skip pending task');

  console.log('\nPASS: smoke-care-task-roles');
}

main().catch((err) => {
  console.error('\nFAIL:', err.message);
  process.exit(1);
});

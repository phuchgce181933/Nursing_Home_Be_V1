/**
 * Smoke test: nurse resident scope + min 1 resident + care schedule assignment validation
 * Run: node scripts/smoke-resident-scope.js
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

async function main() {
  const workDate = futureDate();
  console.log('Smoke: resident scope + min 1, workDate =', workDate);

  const managerToken = await login('manager@test.com', 'password123');
  const nurseAToken = await login('nurse@test.com', 'password123');

  const staffRes = await api('GET', '/staff?role=nurse&limit=50', managerToken);
  const nurses = staffRes.body.data || [];
  const nurseA = nurses.find((u) => u.email === 'nurse@test.com');
  const nurseB = nurses.find((u) => u.email === 'nurse2@seed.com' || u.staffProfile?.staffCode === 'NUR002');
  if (!nurseA?.staffProfile?._id) throw new Error('nurse@test.com profile not found');
  if (!nurseB?._id) throw new Error('Second nurse (NUR002) not found for scope test');

  let nurseBToken;
  try {
    nurseBToken = await login(nurseB.email, 'password123');
  } catch {
    nurseBToken = await login(nurseB.email, 'Password123!');
  }

  const listA = await api('GET', '/nurse/meal-plans/residents', nurseAToken);
  const listB = await api('GET', '/nurse/meal-plans/residents', nurseBToken);
  if (listA.status !== 200) throw new Error(`Nurse A list residents: ${listA.status} ${listA.body.message}`);
  if (listB.status !== 200) throw new Error(`Nurse B list residents: ${listB.status} ${listB.body.message}`);

  const idsA = new Set(unwrapList(listA.body).map((r) => String(r._id)));
  const idsB = new Set(unwrapList(listB.body).map((r) => String(r._id)));
  console.log(`Nurse A assigned residents: ${idsA.size}`);
  console.log(`Nurse B assigned residents: ${idsB.size}`);

  if (!idsA.size) throw new Error('Nurse A should have assigned residents');
  if (!idsB.size) throw new Error('Nurse B should have assigned residents');

  const overlap = [...idsA].filter((id) => idsB.has(id));
  if (overlap.length === idsA.size && overlap.length === idsB.size) {
    throw new Error('Nurse A and B should not see identical resident sets');
  }

  const assignedApi = await api('GET', `/staff/${nurseA._id}/residents/assigned`, managerToken);
  if (assignedApi.status !== 200) {
    throw new Error(`GET staff assigned residents: ${assignedApi.status}`);
  }
  const assignedIds = new Set(unwrapList(assignedApi.body).map((r) => String(r._id)));
  if (assignedIds.size !== idsA.size) {
    throw new Error('Meal plan resident list should match staff assigned API for nurse A');
  }

  const residentA = [...idsA][0];
  const outsider = [...idsB].find((id) => !idsA.has(id));
  if (!outsider) throw new Error('Need a resident only assigned to nurse B');

  const mealEntry = {
    residentId: residentA,
    mealType: 'breakfast',
    mealName: 'Smoke breakfast',
    calories: 300,
  };

  const createOne = await api('POST', '/nurse/meal-plans/drafts', nurseAToken, {
    workDate,
    careStage: 'recovery',
    entries: [mealEntry],
  });
  if (createOne.status !== 201 && createOne.status !== 200) {
    throw new Error(`Create meal plan with 1 resident failed: ${createOne.status} ${createOne.body.message}`);
  }
  console.log('OK: meal plan draft with 1 resident');

  const createZero = await api('POST', '/nurse/meal-plans/drafts', nurseAToken, {
    workDate,
    careStage: 'recovery',
    entries: [],
  });
  if (createZero.status !== 400) {
    throw new Error(`Empty entries should be 400, got ${createZero.status}`);
  }
  console.log('OK: empty entries rejected');

  const createOutsider = await api('POST', '/nurse/meal-plans/drafts', nurseAToken, {
    workDate,
    careStage: 'recovery',
    entries: [{ ...mealEntry, residentId: outsider }],
  });
  if (createOutsider.status !== 403) {
    throw new Error(`Outsider resident should be 403, got ${createOutsider.status}`);
  }
  console.log('OK: outsider resident rejected on create');

  const nutritionList = await api('GET', '/nurse/nutrition-reports/residents', nurseAToken);
  if (nutritionList.status !== 200) {
    throw new Error(`Nutrition list failed: ${nutritionList.status}`);
  }
  const nutritionIds = new Set(unwrapList(nutritionList.body).map((r) => String(r.residentId)));
  for (const id of idsA) {
    if (!nutritionIds.has(id)) throw new Error(`Nutrition list missing assigned resident ${id}`);
  }
  console.log('OK: nutrition report list scoped');

  const nutritionOutsider = await api('GET', `/nurse/nutrition-reports/residents/${outsider}`, nurseAToken);
  if (nutritionOutsider.status !== 403) {
    throw new Error(`Nutrition detail outsider should be 403, got ${nutritionOutsider.status}`);
  }
  console.log('OK: nutrition report detail 403 for outsider');

  const shiftsRes = await api(
    'GET',
    `/shifts?fromDate=${workDate}&toDate=${workDate}&assignedStaffId=${nurseA.staffProfile._id}&limit=50`,
    managerToken
  );
  const shifts = unwrapList(shiftsRes.body);
  let nurseAShift = shifts.find((s) => ['published', 'confirmed', 'draft'].includes(s.status));

  let shiftId = nurseAShift?._id;
  let scheduledTime = nurseAShift?.startTime || '09:00';
  if (!shiftId) {
    const templates = await api('GET', '/shift-templates', managerToken);
    const templateList = templates.body.data?.data || templates.body.data || [];
    const template = templateList.find((t) => t.shiftCode === 'DAY') || templateList[0];
    const createShift = await api('POST', '/shifts', managerToken, {
      shiftTemplateId: template._id,
      workDate,
      assignedStaffId: nurseA.staffProfile._id,
      taskDescription: 'Smoke care schedule',
    });
    if (createShift.status !== 201) {
      throw new Error(`Create shift for care schedule: ${createShift.status} ${createShift.body.message}`);
    }
    nurseAShift = createShift.body.shift || createShift.body.data;
    shiftId = nurseAShift?._id;
    scheduledTime = nurseAShift?.startTime || '09:00';
    if (!shiftId) throw new Error('Could not resolve shift id after create');
    const publishShift = await api('PUT', `/shifts/${shiftId}/publish`, managerToken);
    if (publishShift.status !== 200) {
      throw new Error(`Publish shift failed: ${publishShift.status} ${publishShift.body.message}`);
    }
  }

  const badCareSchedule = await api('POST', '/staff/care-schedules/drafts', managerToken, {
    workDate,
    title: 'Smoke bad assignment',
    entries: [
      {
        residentId: outsider,
        staffProfileId: nurseA.staffProfile._id,
        shiftId,
        taskType: 'morning_care',
        careLevel: 'low',
        scheduledTime,
        source: 'manual',
      },
    ],
  });
  if (badCareSchedule.status !== 400) {
    throw new Error(`Care schedule wrong assignment should be 400, got ${badCareSchedule.status}`);
  }
  console.log('OK: care schedule rejects resident not assigned to staff');

  const goodCareSchedule = await api('POST', '/staff/care-schedules/drafts', managerToken, {
    workDate,
    title: 'Smoke good assignment',
    entries: [
      {
        residentId: residentA,
        staffProfileId: nurseA.staffProfile._id,
        shiftId,
        taskType: 'morning_care',
        careLevel: 'low',
        scheduledTime,
        source: 'manual',
      },
    ],
  });
  if (goodCareSchedule.status !== 201 && goodCareSchedule.status !== 200) {
    throw new Error(`Care schedule with 1 resident failed: ${goodCareSchedule.status} ${goodCareSchedule.body.message}`);
  }
  console.log('OK: care schedule draft with 1 assigned resident');

  console.log('\nPASS: smoke-resident-scope');
}

main().catch((err) => {
  console.error('\nFAIL:', err.message);
  process.exit(1);
});

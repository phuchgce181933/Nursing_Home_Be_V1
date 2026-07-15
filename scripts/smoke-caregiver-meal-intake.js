/**
 * Smoke test: caregiver meal intake — residents dropdown + published meal plan lookup
 * Run: node scripts/smoke-caregiver-meal-intake.js
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { todayVN, nowVN, formatTimeVN } = require('../utils/shiftTime');

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

function futureMealTimes() {
  const now = nowVN();
  const addMin = (mins) => formatTimeVN(new Date(now.getTime() + mins * 60000));
  return {
    breakfastTime: addMin(45),
    lunchTime: addMin(105),
    dinnerTime: addMin(165),
  };
}

function todayVNDate() {
  return todayVN();
}

const unwrapList = (body) => {
  const payload = body?.data;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const unwrapData = (body) => body?.data ?? body;

async function ensureCaregiverAssigned(adminToken, caregiverUserId, residentId, currentAssigned) {
  const ids = new Set(currentAssigned.map((r) => String(r._id)));
  if (ids.has(String(residentId))) return;

  ids.add(String(residentId));
  const assign = await api('PUT', `/staff/${caregiverUserId}/residents`, adminToken, {
    residentIds: [...ids],
  });
  if (assign.status !== 200) {
    throw new Error(`Assign resident to caregiver failed: ${assign.status} ${assign.body?.message}`);
  }
  console.log('OK: assigned resident to caregiver');
}

async function publishScheduleAndPlan(nurseToken, workDate, residentId, mealName) {
  const times = futureMealTimes();
  const scheduleCreate = await api('POST', '/nurse/meal-time-schedules/drafts', nurseToken, {
    workDate,
    title: `Smoke caregiver intake schedule ${mealName}`,
    entries: [
      {
        residentId,
        breakfastTime: times.breakfastTime,
        lunchTime: times.lunchTime,
        dinnerTime: times.dinnerTime,
        source: 'manual',
      },
    ],
  });
  if (scheduleCreate.status !== 201 && scheduleCreate.status !== 200) {
    throw new Error(`Create schedule failed: ${scheduleCreate.status} ${scheduleCreate.body?.message}`);
  }
  const scheduleId = String(
    scheduleCreate.body?.data?.schedule?._id ||
      scheduleCreate.body?.data?._id ||
      scheduleCreate.body?.schedule?._id ||
      ''
  );
  if (!scheduleId) throw new Error('Create schedule: missing id');

  const publishSchedule = await api('POST', `/nurse/meal-time-schedules/${scheduleId}/publish`, nurseToken);
  if (publishSchedule.status !== 200 && publishSchedule.status !== 201) {
    throw new Error(`Publish schedule failed: ${publishSchedule.status} ${publishSchedule.body?.message}`);
  }

  const planCreate = await api('POST', '/nurse/meal-plans/drafts', nurseToken, {
    workDate,
    mealTimeScheduleDayId: scheduleId,
    careStage: 'maintenance',
    title: `Smoke caregiver intake plan ${mealName}`,
    entries: [
      {
        residentId,
        mealType: 'breakfast',
        mealName,
        calories: 320,
        mealTime: times.breakfastTime,
      },
    ],
  });
  if (planCreate.status !== 201 && planCreate.status !== 200) {
    throw new Error(`Create meal plan failed: ${planCreate.status} ${planCreate.body?.message}`);
  }
  const planId = String(
    planCreate.body?.data?.plan?._id || planCreate.body?.data?._id || planCreate.body?.plan?._id || ''
  );
  if (!planId) throw new Error('Create meal plan: missing id');

  const publishPlan = await api('POST', `/nurse/meal-plans/${planId}/publish`, nurseToken);
  if (publishPlan.status !== 200 && publishPlan.status !== 201) {
    throw new Error(`Publish meal plan failed: ${publishPlan.status} ${publishPlan.body?.message}`);
  }

  return { scheduleId, planId };
}

async function deleteExistingIntakeNote(caregiverToken, residentId, workDate) {
  const list = await api(
    'GET',
    `/caregiver/meal-intake-notes?residentId=${residentId}&workDate=${workDate}&mealType=breakfast&limit=10`,
    caregiverToken
  );
  const notes = unwrapList(list.body);
  for (const note of notes) {
    const del = await api('DELETE', `/caregiver/meal-intake-notes/${note._id}`, caregiverToken);
    if (del.status !== 200) {
      throw new Error(`Delete existing intake note failed: ${del.status} ${del.body?.message}`);
    }
  }
}

async function main() {
  const workDate = todayVNDate();
  console.log('Smoke: caregiver meal intake, workDate =', workDate);

  const adminToken = await login('admin@test.com', 'password123');
  const nurseToken = await login('nurse@test.com', 'password123');
  let caregiverToken;
  try {
    caregiverToken = await login('caregiver@test.com', 'password123');
  } catch {
    caregiverToken = await login('caregiver@seed.com', 'password123');
  }

  const staffRes = await api('GET', '/staff?limit=100', adminToken);
  const staffList = staffRes.body.data || [];
  const caregiver = staffList.find(
    (u) => u.email === 'caregiver@test.com' || u.email === 'caregiver@seed.com'
  );
  if (!caregiver?._id) throw new Error('Caregiver user not found');

  const nurseResidentsRes = await api('GET', '/nurse/meal-plans/residents', nurseToken);
  const nurseResidents = unwrapList(nurseResidentsRes.body);
  if (!nurseResidents.length) throw new Error('Nurse has no assigned residents');
  const residentA = nurseResidents[0];
  const residentAId = String(residentA._id);

  const caregiverAssignedRes = await api('GET', `/staff/${caregiver._id}/residents/assigned`, adminToken);
  const caregiverAssigned = unwrapList(caregiverAssignedRes.body);
  await ensureCaregiverAssigned(adminToken, caregiver._id, residentAId, caregiverAssigned);

  const outsider = nurseResidents.find((r) => String(r._id) !== residentAId);
  if (outsider) {
    await publishScheduleAndPlan(
      nurseToken,
      workDate,
      String(outsider._id),
      'Smoke outsider breakfast only'
    );
    console.log('OK: published newer meal plan for different resident (lookup isolation)');
  }

  const mealName = 'Smoke caregiver breakfast A';
  await publishScheduleAndPlan(nurseToken, workDate, residentAId, mealName);
  console.log('OK: published meal time schedule + meal plan for resident A');

  const residentsRes = await api('GET', '/caregiver/meal-intake-notes/residents', caregiverToken);
  if (residentsRes.status !== 200) {
    throw new Error(`List caregiver residents failed: ${residentsRes.status} ${residentsRes.body?.message}`);
  }
  const caregiverResidents = unwrapList(residentsRes.body);
  if (!caregiverResidents.some((r) => String(r._id) === residentAId)) {
    throw new Error(`Resident A missing from caregiver dropdown list (${caregiverResidents.length} items)`);
  }
  console.log('OK: caregiver residents list includes resident A');

  const contextRes = await api(
    'GET',
    `/caregiver/meal-intake-notes/context?residentId=${residentAId}&workDate=${workDate}&mealType=breakfast`,
    caregiverToken
  );
  if (contextRes.status !== 200) {
    throw new Error(`Meal context failed: ${contextRes.status} ${contextRes.body?.message}`);
  }
  const context = unwrapData(contextRes.body);
  if (!context?.plannedMeal?.mealName) {
    throw new Error(`Expected plannedMeal for resident A, got ${JSON.stringify(context)}`);
  }
  if (context.plannedMeal.mealName !== mealName) {
    throw new Error(
      `Wrong planned meal (lookup picked wrong plan): expected "${mealName}", got "${context.plannedMeal.mealName}"`
    );
  }
  console.log('OK: meal context returns correct published plan for resident A');

  await deleteExistingIntakeNote(caregiverToken, residentAId, workDate);

  const createRes = await api('POST', '/caregiver/meal-intake-notes', caregiverToken, {
    residentId: residentAId,
    workDate,
    mealType: 'breakfast',
    intakeStatus: 'full',
    notes: 'Smoke caregiver meal intake',
  });
  if (createRes.status !== 201) {
    throw new Error(`Create intake note failed: ${createRes.status} ${createRes.body?.message}`);
  }
  const created = unwrapData(createRes.body);
  if (!created?._id) throw new Error('Create intake note: missing id');
  console.log('OK: created meal intake note');

  console.log('\nPASS: smoke-caregiver-meal-intake');
}

main().catch((err) => {
  console.error('\nFAIL:', err.message);
  process.exit(1);
});

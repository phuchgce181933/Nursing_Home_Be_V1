/**
 * Smoke test: meal plan requires published mealTimeScheduleDayId
 * Run: node scripts/smoke-meal-plan-schedule-link.js
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const mongoose = require('mongoose');
const MealPlanDay = require('../models/mealPlanDay');

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

function futureDate(days = 14) {
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
  console.log('Smoke: meal plan ↔ meal time schedule, workDate =', workDate);

  const nurseToken = await login('nurse@test.com', 'password123');

  const residentsRes = await api('GET', '/nurse/meal-plans/residents', nurseToken);
  const residents = unwrapList(residentsRes.body);
  if (!residents.length) throw new Error('No assigned residents for nurse');
  const residentA = residents[0];
  const residentB = residents[1];
  const residentAId = String(residentA._id);

  const scheduleCreate = await api('POST', '/nurse/meal-time-schedules/drafts', nurseToken, {
    workDate,
    title: 'Smoke meal time schedule',
    entries: [
      {
        residentId: residentAId,
        breakfastTime: '07:30',
        lunchTime: '11:30',
        dinnerTime: '17:30',
        source: 'manual',
      },
    ],
  });
  if (scheduleCreate.status !== 201 && scheduleCreate.status !== 200) {
    throw new Error(`Create schedule failed: ${scheduleCreate.status} ${scheduleCreate.body.message}`);
  }
  const scheduleId =
    scheduleCreate.body.data?.schedule?._id
    || scheduleCreate.body.schedule?._id
    || scheduleCreate.body.data?._id;
  if (!scheduleId) throw new Error('No schedule id from create');

  const publish = await api('POST', `/nurse/meal-time-schedules/${scheduleId}/publish`, nurseToken);
  if (publish.status !== 200 && publish.status !== 201) {
    throw new Error(`Publish schedule failed: ${publish.status} ${publish.body.message}`);
  }
  console.log('OK: published meal time schedule');

  const noScheduleId = await api('POST', '/nurse/meal-plans/drafts', nurseToken, {
    workDate,
    careStage: 'recovery',
    entries: [
      {
        residentId: residentAId,
        mealType: 'breakfast',
        mealName: 'Smoke breakfast',
        calories: 300,
      },
    ],
  });
  if (noScheduleId.status !== 400) {
    throw new Error(`Create without mealTimeScheduleDayId should be 400, got ${noScheduleId.status}`);
  }
  console.log('OK: meal plan without schedule id rejected');

  const validPlan = await api('POST', '/nurse/meal-plans/drafts', nurseToken, {
    workDate,
    mealTimeScheduleDayId: scheduleId,
    careStage: 'recovery',
    entries: [
      {
        residentId: residentAId,
        mealType: 'breakfast',
        mealName: 'Smoke breakfast linked',
        calories: 300,
      },
    ],
  });
  if (validPlan.status !== 201 && validPlan.status !== 200) {
    throw new Error(`Valid plan create failed: ${validPlan.status} ${validPlan.body.message}`);
  }
  const plan = validPlan.body.data?.plan || validPlan.body.plan || validPlan.body.data;
  const entry = plan?.entries?.[0];
  if (!entry || entry.mealTime !== '07:30') {
    throw new Error(`Expected mealTime 07:30 from schedule, got ${entry?.mealTime}`);
  }
  console.log('OK: meal plan created with schedule-linked meal time');

  if (residentB) {
    const outsider = await api('POST', '/nurse/meal-plans/drafts', nurseToken, {
      workDate,
      mealTimeScheduleDayId: scheduleId,
      careStage: 'recovery',
      entries: [
        {
          residentId: String(residentB._id),
          mealType: 'lunch',
          mealName: 'Outsider lunch',
          calories: 400,
        },
      ],
    });
    if (outsider.status !== 400) {
      throw new Error(`Outsider resident should be 400, got ${outsider.status}`);
    }
    console.log('OK: resident not in schedule rejected');
  }

  const draftOnly = await api('POST', '/nurse/meal-time-schedules/drafts', nurseToken, {
    workDate,
    title: 'Smoke draft for delete guard',
    entries: [
      {
        residentId: residentAId,
        breakfastTime: '08:00',
        lunchTime: '12:00',
        dinnerTime: '18:00',
        source: 'manual',
      },
    ],
  });
  const draftScheduleId =
    draftOnly.body.data?.schedule?._id
    || draftOnly.body.schedule?._id
    || draftOnly.body.data?._id;
  if (!draftScheduleId) throw new Error('No draft schedule id');

  const uri =
    process.env.MONGO_URI_LOCAL
    || process.env.MONGODB_URI
    || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI_LOCAL / MONGODB_URI required for delete-guard test');
  await mongoose.connect(uri);
  const User = require('../models/user');
  const nurseUser = await User.findOne({ email: 'nurse@test.com' }).select('_id');
  await MealPlanDay.create({
    workDate: new Date(workDate),
    mealTimeScheduleDayId: draftScheduleId,
    careStage: 'recovery',
    title: 'Smoke orphan link',
    status: 'draft',
    createdBy: nurseUser._id,
  });

  const deleteBlocked = await api('DELETE', `/nurse/meal-time-schedules/${draftScheduleId}`, nurseToken);
  await MealPlanDay.deleteMany({ title: 'Smoke orphan link' });
  await mongoose.disconnect();

  if (deleteBlocked.status !== 409) {
    throw new Error(`Delete linked draft schedule should be 409, got ${deleteBlocked.status}`);
  }
  console.log('OK: delete schedule blocked when meal plan references it');

  console.log('\nPASS: smoke-meal-plan-schedule-link');
}

main().catch((err) => {
  console.error('\nFAIL:', err.message);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});

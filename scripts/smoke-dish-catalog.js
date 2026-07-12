/**
 * Smoke test: admin dish CRUD + nurse meal plan entry with dishId
 * Run: node scripts/smoke-dish-catalog.js
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

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
  d.setUTCDate(d.getUTCDate() + days + Math.floor(Math.random() * 30));
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
  const dishName = `Smoke Chao ${Date.now()}`;
  console.log('Smoke: dish catalog + meal plan entry, workDate =', workDate);

  const adminToken = await login('admin@test.com', 'password123');
  const nurseToken = await login('nurse@test.com', 'password123');

  const createDish = await api('POST', '/nutrition/dishes', adminToken, {
    name: dishName,
    calories: 180,
    ingredients: ['yến mạch', 'sữa'],
    isActive: true,
  });
  if (createDish.status !== 201) {
    throw new Error(`Create dish failed: ${createDish.status} ${createDish.body?.message}`);
  }
  const dishId = String(createDish.body?.data?.dish?._id || createDish.body?.data?._id || '');
  if (!dishId) throw new Error('Create dish: missing id');

  const dup = await api('POST', '/nutrition/dishes', adminToken, {
    name: dishName,
    calories: 100,
  });
  if (dup.status !== 409) {
    throw new Error(`Expected duplicate dish 409, got ${dup.status}`);
  }

  const nurseList = await api('GET', '/nutrition/dishes?activeOnly=true', nurseToken);
  const dishes = unwrapList(nurseList.body);
  if (!dishes.some((d) => String(d._id) === dishId)) {
    throw new Error('Nurse dish list missing created dish');
  }

  const residentsRes = await api('GET', '/nurse/meal-plans/residents', nurseToken);
  const residents = unwrapList(residentsRes.body);
  if (!residents.length) throw new Error('No assigned residents for nurse');
  const residentId = String(residents[0]._id);

  const scheduleCreate = await api('POST', '/nurse/meal-time-schedules/drafts', nurseToken, {
    workDate,
    title: 'Smoke dish schedule',
    entries: [
      {
        residentId,
        breakfastTime: '07:30',
        lunchTime: '11:30',
        dinnerTime: '17:30',
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
      scheduleCreate.body?.data?.plan?._id ||
      ''
  );
  if (!scheduleId) throw new Error('Create schedule: missing id');

  const publishSchedule = await api('POST', `/nurse/meal-time-schedules/${scheduleId}/publish`, nurseToken);
  if (publishSchedule.status !== 200) {
    throw new Error(`Publish schedule failed: ${publishSchedule.status} ${publishSchedule.body?.message}`);
  }

  const planCreate = await api('POST', '/nurse/meal-plans/drafts', nurseToken, {
    workDate,
    mealTimeScheduleDayId: scheduleId,
    careStage: 'maintenance',
    title: 'Smoke dish meal plan',
    entries: [
      {
        residentId,
        mealType: 'dinner',
        dishId,
        source: 'catalog',
        mealTime: '17:30',
      },
    ],
  });
  if (planCreate.status !== 201) {
    throw new Error(`Create meal plan failed: ${planCreate.status} ${planCreate.body?.message}`);
  }
  const entry = planCreate.body?.data?.plan?.entries?.[0] || planCreate.body?.data?.entries?.[0];
  if (!entry || entry.mealName !== dishName || entry.calories !== 180) {
    throw new Error(`Meal plan entry snapshot mismatch: ${JSON.stringify(entry)}`);
  }
  if (String(entry.dishId?._id || entry.dishId || '') !== dishId) {
    throw new Error('Meal plan entry missing dishId');
  }

  const deactivate = await api('PUT', `/nutrition/dishes/${dishId}`, adminToken, { isActive: false });
  if (deactivate.status !== 200) {
    throw new Error(`Deactivate dish failed: ${deactivate.status}`);
  }

  const inactivePlan = await api('POST', '/nurse/meal-plans/drafts', nurseToken, {
    workDate,
    mealTimeScheduleDayId: scheduleId,
    careStage: 'maintenance',
    title: 'Smoke inactive dish plan',
    entries: [
      {
        residentId,
        mealType: 'lunch',
        dishId,
        source: 'catalog',
        mealTime: '12:00',
      },
    ],
  });
  if (inactivePlan.status !== 400 || inactivePlan.body?.errorCode !== 'DISH_INACTIVE') {
    throw new Error(
      `Expected DISH_INACTIVE 400, got ${inactivePlan.status} ${inactivePlan.body?.errorCode || inactivePlan.body?.message}`
    );
  }

  await api('DELETE', `/nutrition/dishes/${dishId}`, adminToken);
  console.log('PASS smoke-dish-catalog.js');
}

main()
  .catch((err) => {
    console.error('FAIL', err.message || err);
    process.exit(1);
  });

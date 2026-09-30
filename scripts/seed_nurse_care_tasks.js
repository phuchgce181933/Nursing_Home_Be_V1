/**
 * seed_nurse_care_tasks.js — DOCQA-only, LOCAL-only.
 *
 * Purpose: the Mobile Nurse "Nhiệm vụ chăm sóc" screen shows "Không có nhiệm vụ nào"
 * because CareTask seed data is stale (stops several days before today). This script
 * seeds CareTasks for the DOCQA nurse's assigned resident across VN days -1 / 0 / +1 so
 * that TODAY populates all four Mobile filter chips (pending / in_progress / completed / skipped).
 *
 * Safety: NEVER touches Atlas. Connects directly to the local mongod, asserts host is
 * 127.0.0.1/localhost AND db name is nursing_home_local, refuses any mongodb+srv URI.
 * Idempotent upserts only — no deletes, no cleanup, unrelated rows untouched.
 *
 * Run (backend cwd):
 *   node scripts/seed_nurse_care_tasks.js
 * Optional verify against a running local backend (default port 3100):
 *   VERIFY_PORT=3100 node scripts/seed_nurse_care_tasks.js
 */
const mongoose = require('mongoose');
const http = require('http');
const {
  parseWorkDate,
  todayVN,
  addDaysToDateStr,
} = require('../utils/shiftTime');

const LOCAL_URI =
  process.env.MONGO_URI_LOCAL || 'mongodb://127.0.0.1:27017/nursing_home_local';
const EXPECTED_DB = 'nursing_home_local';

// DOCQA fixtures (documentation_work/.docqa_credentials.json).
const NURSE_STAFF_PROFILE_ID = '6a9ebcf03e61493d37ba4b93';
const RESIDENT_ID = '6a9ebe9fadf06f1013657897';
const ADMIN_EMAIL = 'docqa.admin@local.test';
const NURSE_EMAIL = 'docqa.nurse@local.test';
const NURSE_PASSWORD = 'DocqaTest!2026';

const oid = (s) => new mongoose.Types.ObjectId(s);

// VN-local midnight (Shift.workDate convention — matches existing rows + autoSkip).
const vnMidnight = (dayStr) => new Date(`${dayStr}T00:00:00+07:00`);

function assertLocalOnly(uri) {
  if (/mongodb\+srv/i.test(uri)) {
    throw new Error(`REFUSED: mongodb+srv (Atlas) URI is forbidden: ${uri.replace(/\/\/[^@]*@/, '//***@')}`);
  }
  if (!/(127\.0\.0\.1|localhost)/i.test(uri)) {
    throw new Error('REFUSED: URI host must be 127.0.0.1 or localhost');
  }
}

async function ensureShift(db, { dayStr, startTime, endTime }) {
  const workDate = vnMidnight(dayStr);
  const key = {
    assignedStaffId: oid(NURSE_STAFF_PROFILE_ID),
    workDate,
    startTime,
    endTime,
  };
  const now = new Date();
  await db.collection('shifts').updateOne(
    key,
    {
      $setOnInsert: { ...key, createdAt: now },
      $set: {
        name: `[DOCQA] Ca ${startTime}-${endTime}`,
        status: 'confirmed',
        updatedAt: now,
      },
    },
    { upsert: true }
  );
  const shift = await db.collection('shifts').findOne(key);
  return shift._id;
}

async function upsertTask(db, { dayStr, shiftId, scheduledTime, taskType, careLevel, status, note }) {
  const workDate = parseWorkDate(dayStr); // UTC midnight — matches listCareTasks window
  const key = {
    staffProfileId: oid(NURSE_STAFF_PROFILE_ID),
    residentId: oid(RESIDENT_ID),
    workDate,
    scheduledTime,
    taskType,
  };
  const now = new Date();
  await db.collection('caretasks').updateOne(
    key,
    {
      $setOnInsert: { ...key, createdAt: now },
      $set: {
        shiftId,
        careLevel,
        status,
        notes: `[DOCQA] ${note}`,
        assignedBy: SEED_ADMIN_ID,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}

let SEED_ADMIN_ID = null;

async function main() {
  assertLocalOnly(LOCAL_URI);
  await mongoose.connect(LOCAL_URI);
  const conn = mongoose.connection;
  if (conn.name !== EXPECTED_DB) {
    throw new Error(`REFUSED: connected db is "${conn.name}", expected "${EXPECTED_DB}"`);
  }
  console.log(`Connected: host=${conn.host}:${conn.port} db=${conn.name}`);
  const db = conn.db;

  // Resolve, never invent.
  const nurseSp = await db.collection('staffprofiles').findOne({ _id: oid(NURSE_STAFF_PROFILE_ID) });
  if (!nurseSp) throw new Error('DOCQA nurse StaffProfile not found — run the DOCQA seed first.');
  const resident = await db.collection('residents').findOne({ _id: oid(RESIDENT_ID) });
  if (!resident) throw new Error('DOCQA resident not found — run the DOCQA seed first.');
  const admin = await db.collection('users').findOne({ email: ADMIN_EMAIL }, { projection: { _id: 1 } });
  if (!admin) throw new Error('DOCQA admin not found — run the DOCQA seed first.');
  SEED_ADMIN_ID = admin._id;

  // Ensure the resident is in the nurse's assigned scope (same intent as the DOCQA seed;
  // never widens beyond this one DOCQA resident).
  await db.collection('staffprofiles').updateOne(
    { _id: oid(NURSE_STAFF_PROFILE_ID) },
    { $addToSet: { assignedResidentIds: oid(RESIDENT_ID) } }
  );

  const yesterday = addDaysToDateStr(todayVN(), -1);
  const today = todayVN();
  const tomorrow = addDaysToDateStr(todayVN(), 1);

  // Shifts: yesterday ended (07-15), today OPEN overnight (08:00->07:00 next day),
  // tomorrow not-yet-ended (07-15).
  const shiftYesterday = await ensureShift(db, { dayStr: yesterday, startTime: '07:00', endTime: '15:00' });
  const shiftToday = await ensureShift(db, { dayStr: today, startTime: '08:00', endTime: '07:00' });
  const shiftTomorrow = await ensureShift(db, { dayStr: tomorrow, startTime: '07:00', endTime: '15:00' });

  // Yesterday — terminal statuses only (autoSkip only rewrites pending/in_progress).
  await upsertTask(db, { dayStr: yesterday, shiftId: shiftYesterday, scheduledTime: '07:30', taskType: 'morning_care', careLevel: 'medium', status: 'completed', note: 'Vệ sinh buổi sáng đã hoàn thành.' });
  await upsertTask(db, { dayStr: yesterday, shiftId: shiftYesterday, scheduledTime: '11:00', taskType: 'meal_assistance', careLevel: 'low', status: 'skipped', note: 'Cư dân từ chối hỗ trợ ăn trưa.' });
  await upsertTask(db, { dayStr: yesterday, shiftId: shiftYesterday, scheduledTime: '14:00', taskType: 'physical_therapy', careLevel: 'high', status: 'missed', note: 'Không thực hiện được buổi tập.' });

  // Today — one per Mobile filter chip; open shift keeps pending/in_progress alive.
  await upsertTask(db, { dayStr: today, shiftId: shiftToday, scheduledTime: '06:30', taskType: 'morning_care', careLevel: 'medium', status: 'pending', note: 'Vệ sinh cá nhân và thay đồ buổi sáng.' });
  await upsertTask(db, { dayStr: today, shiftId: shiftToday, scheduledTime: '09:00', taskType: 'medication', careLevel: 'high', status: 'in_progress', note: 'Cho uống thuốc huyết áp buổi sáng.' });
  await upsertTask(db, { dayStr: today, shiftId: shiftToday, scheduledTime: '12:00', taskType: 'meal_assistance', careLevel: 'low', status: 'completed', note: 'Hỗ trợ ăn trưa, ăn hết suất.' });
  await upsertTask(db, { dayStr: today, shiftId: shiftToday, scheduledTime: '20:00', taskType: 'evening_check', careLevel: 'medium', status: 'skipped', note: 'Cư dân đã ngủ, bỏ qua kiểm tra tối.' });

  // Tomorrow — future, not ended.
  await upsertTask(db, { dayStr: tomorrow, shiftId: shiftTomorrow, scheduledTime: '07:30', taskType: 'morning_care', careLevel: 'medium', status: 'pending', note: 'Kế hoạch vệ sinh buổi sáng.' });
  await upsertTask(db, { dayStr: tomorrow, shiftId: shiftTomorrow, scheduledTime: '10:00', taskType: 'physical_therapy', careLevel: 'high', status: 'in_progress', note: 'Buổi tập phục hồi chức năng.' });

  console.log(`Seeded CareTasks for VN days: ${yesterday}, ${today}, ${tomorrow}`);

  // Direct DB summary
  for (const [label, day] of [['yesterday', yesterday], ['today', today], ['tomorrow', tomorrow]]) {
    const wd = parseWorkDate(day);
    const end = new Date(wd.getTime() + 24 * 3600 * 1000 - 1);
    const rows = await db.collection('caretasks').aggregate([
      { $match: { staffProfileId: oid(NURSE_STAFF_PROFILE_ID), workDate: { $gte: wd, $lte: end } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]).toArray();
    const dist = {};
    rows.forEach((r) => { dist[r._id] = r.n; });
    console.log(`  DB ${label} (${day}):`, JSON.stringify(dist));
  }

  await mongoose.disconnect();

  if (process.env.VERIFY_PORT) {
    await verifyViaHttp(Number(process.env.VERIFY_PORT), todayVN());
  }
}

// ---- HTTP self-verification against a running LOCAL backend ----
function req(port, method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      { host: '127.0.0.1', port, method, path, headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      } },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(d); } catch {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function verifyViaHttp(port, today) {
  console.log(`\nHTTP verify against local :${port} as ${NURSE_EMAIL}`);
  const login = await req(port, 'POST', '/api/auth/login', { body: { email: NURSE_EMAIL, password: NURSE_PASSWORD } });
  if (login.status !== 200 || !login.json?.token) {
    throw new Error(`login failed: status ${login.status}`);
  }
  const token = login.json.token;
  const res = await req(port, 'GET', `/api/staff/care-tasks?workDate=${today}`, { token });
  const items = res.json?.data || [];
  const chips = ['pending', 'in_progress', 'completed', 'skipped'];
  const dist = {};
  items.forEach((t) => { dist[t.status] = (dist[t.status] || 0) + 1; });
  const codes = [...new Set(items.map((t) => t.staffProfileId?.staffCode))];
  console.log(`  GET care-tasks?workDate=${today} -> status ${res.status}, total ${res.json?.total}`);
  console.log(`  staffCodes: ${JSON.stringify(codes)}  status dist: ${JSON.stringify(dist)}`);
  const missing = chips.filter((c) => !dist[c]);
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  if (codes.some((c) => c !== 'DOCQA-NUR-001')) throw new Error(`scope leak: unexpected staffCodes ${JSON.stringify(codes)}`);
  if (missing.length) throw new Error(`today missing chips: ${missing.join(', ')}`);
  console.log('  VERIFY OK — all four filter chips populated for today, scoped to DOCQA-NUR-001.');
}

main().catch((e) => {
  console.error('SEED FAILED:', e.message);
  process.exit(1);
});

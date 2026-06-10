/**
 * Smoke: published past deadline → auto-cancelled; confirmed → kept
 * Run: node scripts/smoke-auto-cancel-shifts.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'local';

const connectDB = require('../config/db');
const mongoose = require('mongoose');
const { autoCancelUnconfirmedPublishedShifts } = require('../services/shiftService');
const shiftRepo = require('../repositories/shiftRepository');
const { todayVN, addDaysToDateStr } = require('../utils/shiftTime');
const StaffProfile = require('../models/staffProfile');
const ShiftTemplate = require('../models/shiftTemplate');

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

function pastShiftWindow() {
  const workDate = addDaysToDateStr(todayVN(), -1);
  return { workDate, startTime: '08:00', endTime: '12:00' };
}

async function main() {
  console.log('Smoke: auto-cancel unconfirmed published shifts');
  await connectDB();

  const managerToken = await login('manager@test.com', 'password123');
  const nurseToken = await login('nurse@test.com', 'password123');

  const nurseProfile = await StaffProfile.findOne({ staffCode: 'NUR003' });
  if (!nurseProfile) throw new Error('Nurse profile not found');

  const template = await ShiftTemplate.findOne({ shiftCode: 'DAY' });
  if (!template) throw new Error('No shift template');

  const { workDate, startTime, endTime } = pastShiftWindow();
  console.log('Using past window:', workDate, startTime, '-', endTime);

  const workDateUtc = new Date(`${workDate}T00:00:00.000Z`);
  const unconfirmed = await shiftRepo.create({
    name: 'Smoke auto-cancel',
    startTime,
    endTime,
    totalHours: 4,
    workDate: workDateUtc,
    assignedStaffId: nurseProfile._id,
    shiftTemplateId: template._id,
    status: 'published',
    changeLog: [],
  });
  const unconfirmedId = unconfirmed._id;

  const { cancelled } = await autoCancelUnconfirmedPublishedShifts();
  const afterCancel = await shiftRepo.findById(unconfirmedId);
  if (afterCancel.status !== 'cancelled') {
    throw new Error(`Expected cancelled, got ${afterCancel.status} (job cancelled=${cancelled})`);
  }
  console.log('PASS: unpublished past deadline → cancelled');

  const confirmed = await shiftRepo.create({
    name: 'Smoke auto-cancel confirmed',
    startTime,
    endTime,
    totalHours: 4,
    workDate: workDateUtc,
    assignedStaffId: nurseProfile._id,
    shiftTemplateId: template._id,
    status: 'published',
    changeLog: [],
  });
  const confirmedId = confirmed._id;
  const confirm = await api('PUT', `/shifts/${confirmedId}/confirm`, nurseToken);
  if (confirm.status !== 200) {
    throw new Error(`Confirm failed: ${confirm.status} ${confirm.body.message}`);
  }

  await autoCancelUnconfirmedPublishedShifts();
  const afterKeep = await shiftRepo.findById(confirmedId);
  if (afterKeep.status !== 'confirmed') {
    throw new Error(`Expected confirmed kept, got ${afterKeep.status}`);
  }
  console.log('PASS: confirmed shift not auto-cancelled');

  await shiftRepo.deleteById(unconfirmedId);
  await shiftRepo.deleteById(confirmedId);

  await mongoose.disconnect();
  console.log('All smoke checks passed.');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAIL:', err.message);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});

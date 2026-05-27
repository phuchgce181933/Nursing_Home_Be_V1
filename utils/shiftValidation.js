const MAX_DAILY_HOURS = 12;
const MAX_CONSECUTIVE_NIGHT_DAYS = 3;
const NIGHT_START_MINUTES = 18 * 60; // 18:00 — typical night-shift start

/** Roles allowed per shift template type (roleCategory or User.role). */
const ALLOWED_ROLES_BY_SHIFT_TYPE = {
  morning: ['doctor', 'nurse', 'staff'],
  afternoon: ['doctor', 'nurse', 'staff'],
  night: ['doctor', 'nurse', 'staff'],
  on_call: ['doctor', 'nurse'],
};

const toMinutes = (timeStr) => {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

/** Duration in hours; supports overnight (end <= start). */
const calcShiftDurationHours = (startTime, endTime) => {
  const s = toMinutes(startTime);
  const e = toMinutes(endTime);
  if (s === null || e === null) return 0;
  return e > s ? (e - s) / 60 : (1440 - s + e) / 60;
};

/** Normalized [start, end) in minutes on workDate; overnight extends past midnight. */
const toInterval = (startTime, endTime) => {
  const s = toMinutes(startTime);
  let e = toMinutes(endTime);
  if (s === null || e === null) return null;
  if (e <= s) e += 1440;
  return { start: s, end: e };
};

/** newStart < existEnd && newEnd > existStart */
const intervalsOverlap = (startA, endA, startB, endB) => {
  const a = toInterval(startA, endA);
  const b = toInterval(startB, endB);
  if (!a || !b) return false;
  return a.start < b.end && a.end > b.start;
};

/**
 * Invalid when end <= start and shift is not an allowed overnight pattern.
 * e.g. 14:00 → 10:00 invalid; 22:00 → 06:00 valid.
 */
const isInvalidTimeRange = (startTime, endTime, { crossesMidnight = false } = {}) => {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === null || end === null) return true;
  if (end > start) return false;
  if (crossesMidnight) return false;
  if (start >= NIGHT_START_MINUTES) return false;
  return true;
};

const isNightShift = ({ startTime, endTime, shiftType, crossesMidnight }) => {
  if (shiftType === 'night') return true;
  if (crossesMidnight) return true;
  const start = toMinutes(startTime);
  if (start === null) return false;
  const end = toMinutes(endTime);
  return start >= NIGHT_START_MINUTES || (end !== null && end <= start && start >= NIGHT_START_MINUTES);
};

const utcDayKey = (date) => {
  const d = new Date(date);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const addUtcDays = (date, days) => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/** True when workDate completes MAX_CONSECUTIVE_NIGHT_DAYS consecutive night-shift days. */
const hasExcessiveConsecutiveNightShifts = (nightDates, workDate) => {
  const keys = new Set(nightDates.map((d) => utcDayKey(d)));
  keys.add(utcDayKey(workDate));
  const anchor = utcDayKey(workDate);
  const dayMs = 86400000;

  for (let startOffset = -(MAX_CONSECUTIVE_NIGHT_DAYS - 1); startOffset <= 0; startOffset += 1) {
    let streak = true;
    for (let d = 0; d < MAX_CONSECUTIVE_NIGHT_DAYS; d += 1) {
      if (!keys.has(anchor + (startOffset + d) * dayMs)) {
        streak = false;
        break;
      }
    }
    if (streak) return true;
  }
  return false;
};

const getStaffRole = (staffProfile) =>
  String(staffProfile?.roleCategory || staffProfile?.userId?.role || '')
    .trim()
    .toLowerCase();

const isRoleAllowedForShiftType = (staffRole, shiftType) => {
  if (!shiftType || !staffRole) return true;
  const allowed = ALLOWED_ROLES_BY_SHIFT_TYPE[shiftType];
  if (!allowed) return true;
  return allowed.includes(staffRole);
};

const isPastWorkDate = (workDate) => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const d = new Date(workDate);
  d.setUTCHours(0, 0, 0, 0);
  return d < today;
};

module.exports = {
  MAX_DAILY_HOURS,
  MAX_CONSECUTIVE_NIGHT_DAYS,
  ALLOWED_ROLES_BY_SHIFT_TYPE,
  toMinutes,
  calcShiftDurationHours,
  toInterval,
  intervalsOverlap,
  isInvalidTimeRange,
  isNightShift,
  utcDayKey,
  addUtcDays,
  hasExcessiveConsecutiveNightShifts,
  getStaffRole,
  isRoleAllowedForShiftType,
  isPastWorkDate,
};

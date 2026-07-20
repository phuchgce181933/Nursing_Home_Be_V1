const { apiErr, CODES } = require('./apiError');

const NIGHT_START_MINUTES = 18 * 60; // 18:00 — typical night-shift start

/** Roles allowed per shift template type (roleCategory or User.role). */
const ALLOWED_ROLES_BY_SHIFT_TYPE = {
  morning: ['doctor', 'nurse', 'caregiver', 'staff'],
  afternoon: ['doctor', 'nurse', 'caregiver', 'staff'],
  night: ['doctor', 'nurse', 'caregiver', 'staff'],
  on_call: ['doctor', 'nurse'],
  custom: ['doctor', 'nurse', 'caregiver', 'staff'],
};

const FLEXIBLE_SHIFT_MIN_HOURS = 1;
const FLEXIBLE_SHIFT_MAX_HOURS = 12;
const SPLIT_SHIFT_MAX_WEEKLY_HOURS = 40;
const SPLIT_DAILY_RATIO = 0.5;
const TIME_HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

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

const isSplitShiftRecord = (shift) => {
  const tpl = shift?.shiftTemplateId;
  if (!tpl || typeof tpl !== 'object') return false;
  return Boolean(tpl.isFlexibleTime) || tpl.shiftCode === 'SPLIT';
};

const getShiftRecordedHours = (shift) => {
  if (shift?.totalHours != null && !Number.isNaN(Number(shift.totalHours))) {
    return Number(shift.totalHours);
  }
  const tpl = shift?.shiftTemplateId;
  if (tpl?.totalHours != null && !Number.isNaN(Number(tpl.totalHours))) {
    return Number(tpl.totalHours);
  }
  return calcShiftDurationHours(shift.startTime, shift.endTime);
};

const calcOtherDayHours = (shifts) =>
  (shifts || [])
    .filter((s) => !isSplitShiftRecord(s))
    .reduce((sum, s) => sum + getShiftRecordedHours(s), 0);

/** Max split duration allowed on a day given hours from non-split shifts. */
const maxSplitHoursForDay = (otherHours) => {
  if (otherHours <= 0) return FLEXIBLE_SHIFT_MAX_HOURS;
  return Math.min(SPLIT_DAILY_RATIO * otherHours, FLEXIBLE_SHIFT_MAX_HOURS);
};

const calcWeeklySplitHours = (weekShifts, { excludeId, additionalSplitHours = 0 } = {}) => {
  let total = additionalSplitHours;
  for (const s of weekShifts || []) {
    if (excludeId && String(s._id) === String(excludeId)) continue;
    if (isSplitShiftRecord(s)) {
      total += getShiftRecordedHours(s);
    }
  }
  return Math.round(total * 100) / 100;
};

/**
 * ERROR-level conflicts for split (SPLIT) shift assignment.
 * @returns {Array<{ type, severity, message, details? }>}
 */
const buildSplitShiftConflicts = ({
  splitHours,
  otherHours,
  existingSplitCount,
  weeklySplitHours,
}) => {
  const conflicts = [];

  if (existingSplitCount > 0) {
    conflicts.push({
      type: 'SPLIT_DAILY_LIMIT',
      severity: 'ERROR',
      message: 'Mỗi nhân viên chỉ được phân tối đa 1 ca gãy trong một ngày.',
      details: { existingSplitCount },
    });
  }

  if (otherHours > 0) {
    const maxSplitHours = maxSplitHoursForDay(otherHours);
    const totalDayHours = Math.round((otherHours + splitHours) * 100) / 100;
    if (splitHours > maxSplitHours) {
      conflicts.push({
        type: 'SPLIT_DAILY_RATIO',
        severity: 'ERROR',
        message: `Thời lượng ca gãy (${splitHours}h) vượt 50% tổng giờ làm trong ngày (${totalDayHours}h). Tối đa cho phép: ${maxSplitHours}h.`,
        details: { splitHours, otherHours, totalDayHours, maxSplitHours },
      });
    }
  }

  if (weeklySplitHours > SPLIT_SHIFT_MAX_WEEKLY_HOURS) {
    conflicts.push({
      type: 'SPLIT_WEEKLY_LIMIT',
      severity: 'ERROR',
      message: `Tổng giờ ca gãy trong tuần (${weeklySplitHours}h) vượt giới hạn ${SPLIT_SHIFT_MAX_WEEKLY_HOURS}h.`,
      details: { weeklySplitHours, limit: SPLIT_SHIFT_MAX_WEEKLY_HOURS },
    });
  }

  return conflicts;
};

const DAY_END_MINUTES = 1440;

const minutesToHHMM = (minutes) => {
  const m = Math.max(0, Math.min(minutes, DAY_END_MINUTES - 1));
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

/** Midnight end of day displays as 00:00. */
const formatDisplayEnd = (endMinutes) => (endMinutes >= DAY_END_MINUTES ? '00:00' : minutesToHHMM(endMinutes));

/** Same-day split shifts cannot end at 00:00 — use 23:59 when the free gap ends at midnight. */
const flexibleEndTimeFromGapEnd = (endMinutes) => {
  if (endMinutes >= DAY_END_MINUTES) return '23:59';
  return minutesToHHMM(endMinutes);
};

const mergeIntervals = (intervals) => {
  const valid = (intervals || []).filter((i) => i && i.start < i.end);
  if (!valid.length) return [];
  const sorted = [...valid].sort((a, b) => a.start - b.start);
  const merged = [{ start: sorted[0].start, end: sorted[0].end }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = merged[merged.length - 1];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ start: cur.start, end: cur.end });
    }
  }
  return merged;
};

/** Portion of a shift that falls on the calendar workDate (00:00–24:00). */
const shiftToDayIntervals = (startTime, endTime) => {
  const iv = toInterval(startTime, endTime);
  if (!iv) return [];
  if (iv.start >= DAY_END_MINUTES) return [];
  const clipped = { start: Math.max(0, iv.start), end: Math.min(iv.end, DAY_END_MINUTES) };
  return clipped.start < clipped.end ? [clipped] : [];
};

/**
 * Free windows within a day for ad-hoc (split) shifts.
 * @param {Array<{ startTime: string, endTime: string }>} existingShifts
 * @param {{ minHours?: number, maxHours?: number, minStartMinutes?: number, maxSplitHours?: number }} opts
 */
const computeFreeTimeSlots = (existingShifts, { minHours, maxHours, minStartMinutes, maxSplitHours } = {}) => {
  const minH = minHours ?? FLEXIBLE_SHIFT_MIN_HOURS;
  let maxH = maxHours ?? FLEXIBLE_SHIFT_MAX_HOURS;
  if (maxSplitHours != null && maxSplitHours > 0) {
    maxH = Math.min(maxH, maxSplitHours);
  }
  const minStart = Math.max(0, minStartMinutes ?? 0);

  const occupied = mergeIntervals(
    (existingShifts || []).flatMap((s) => shiftToDayIntervals(s.startTime, s.endTime))
  );

  const slots = [];
  let cursor = minStart;

  const pushGap = (gapStart, gapEnd) => {
    if (gapEnd <= gapStart) return;
    const gapHours = (gapEnd - gapStart) / 60;
    if (gapHours < minH) return;
    const suggestEnd = Math.min(gapEnd, gapStart + maxH * 60);
    const suggestHours = (suggestEnd - gapStart) / 60;
    slots.push({
      startTime: minutesToHHMM(gapStart),
      endTime: flexibleEndTimeFromGapEnd(suggestEnd),
      displayStart: minutesToHHMM(gapStart),
      displayEnd: formatDisplayEnd(gapEnd),
      totalHours: Math.round(suggestHours * 100) / 100,
    });
  };

  for (const block of occupied) {
    if (block.start > cursor) {
      pushGap(cursor, Math.min(block.start, DAY_END_MINUTES));
    }
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < DAY_END_MINUTES) {
    pushGap(cursor, DAY_END_MINUTES);
  }

  return slots;
};

const validateFlexibleShiftTimes = (startTime, endTime) => {
  if (!startTime || !endTime) {
    throw apiErr(CODES.SHIFT_FLEXIBLE_TIME_REQUIRED, { statusCode: 400 });
  }
  if (!TIME_HHMM_REGEX.test(startTime) || !TIME_HHMM_REGEX.test(endTime)) {
    throw apiErr(CODES.SHIFT_FLEXIBLE_TIME_FORMAT, { statusCode: 400 });
  }
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (end <= start) {
    throw apiErr(CODES.SHIFT_FLEXIBLE_END_BEFORE_START, { statusCode: 400 });
  }
  const hours = (end - start) / 60;
  if (hours < FLEXIBLE_SHIFT_MIN_HOURS) {
    throw apiErr(CODES.SHIFT_FLEXIBLE_DURATION_MIN, {
      statusCode: 400,
      params: { minHours: FLEXIBLE_SHIFT_MIN_HOURS },
    });
  }
  if (hours > FLEXIBLE_SHIFT_MAX_HOURS) {
    throw apiErr(CODES.SHIFT_FLEXIBLE_DURATION_MAX, {
      statusCode: 400,
      params: { maxHours: FLEXIBLE_SHIFT_MAX_HOURS },
    });
  }
  return { startTime, endTime, totalHours: Math.round(hours * 100) / 100 };
};

module.exports = {
  ALLOWED_ROLES_BY_SHIFT_TYPE,
  FLEXIBLE_SHIFT_MIN_HOURS,
  FLEXIBLE_SHIFT_MAX_HOURS,
  SPLIT_SHIFT_MAX_WEEKLY_HOURS,
  SPLIT_DAILY_RATIO,
  TIME_HHMM_REGEX,
  toMinutes,
  minutesToHHMM,
  calcShiftDurationHours,
  toInterval,
  intervalsOverlap,
  mergeIntervals,
  shiftToDayIntervals,
  computeFreeTimeSlots,
  isInvalidTimeRange,
  getStaffRole,
  isRoleAllowedForShiftType,
  isPastWorkDate,
  isSplitShiftRecord,
  getShiftRecordedHours,
  calcOtherDayHours,
  maxSplitHoursForDay,
  calcWeeklySplitHours,
  buildSplitShiftConflicts,
  validateFlexibleShiftTimes,
};

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

const validateFlexibleShiftTimes = (startTime, endTime) => {
  if (!startTime || !endTime) {
    throw Object.assign(new Error('startTime và endTime là bắt buộc cho ca gãy'), { status: 400 });
  }
  if (!TIME_HHMM_REGEX.test(startTime) || !TIME_HHMM_REGEX.test(endTime)) {
    throw Object.assign(new Error('Giờ ca gãy phải có định dạng HH:mm'), { status: 400 });
  }
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (end <= start) {
    throw Object.assign(new Error('Giờ kết thúc phải sau giờ bắt đầu (ca gãy trong cùng ngày)'), { status: 400 });
  }
  const hours = (end - start) / 60;
  if (hours < FLEXIBLE_SHIFT_MIN_HOURS) {
    throw Object.assign(
      new Error(`Ca gãy phải có thời lượng tối thiểu ${FLEXIBLE_SHIFT_MIN_HOURS} giờ`),
      { status: 400 }
    );
  }
  if (hours > FLEXIBLE_SHIFT_MAX_HOURS) {
    throw Object.assign(
      new Error(`Ca gãy không được vượt quá ${FLEXIBLE_SHIFT_MAX_HOURS} giờ`),
      { status: 400 }
    );
  }
  return { startTime, endTime, totalHours: Math.round(hours * 100) / 100 };
};

module.exports = {
  ALLOWED_ROLES_BY_SHIFT_TYPE,
  FLEXIBLE_SHIFT_MIN_HOURS,
  FLEXIBLE_SHIFT_MAX_HOURS,
  TIME_HHMM_REGEX,
  toMinutes,
  calcShiftDurationHours,
  toInterval,
  intervalsOverlap,
  isInvalidTimeRange,
  getStaffRole,
  isRoleAllowedForShiftType,
  isPastWorkDate,
  validateFlexibleShiftTimes,
};

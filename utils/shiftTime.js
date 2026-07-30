const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VN_TZ = 'Asia/Ho_Chi_Minh';
const VN_OFFSET = '+07:00';

const toMinutes = (timeStr) => {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

/**
 * Returns true when `now` (local time) falls within [startTime, endTime).
 * Supports overnight shifts (e.g. 22:00–06:00).
 */
const isShiftActiveNow = (startTime, endTime, now = new Date()) => {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === null || end === null) return false;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (end > start) {
    return nowMinutes >= start && nowMinutes < end;
  }
  return nowMinutes >= start || nowMinutes < end;
};

/**
 * Parses YYYY-MM-DD into UTC midnight Date. Throws if invalid.
 */
const parseWorkDate = (dateStr) => {
  if (!dateStr || !DATE_REGEX.test(dateStr)) {
    throw new Error('date must be YYYY-MM-DD');
  }
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dateStr) {
    throw new Error('date must be YYYY-MM-DD');
  }
  return d;
};

const getLocalDateString = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** YYYY-MM-DD in Vietnam timezone */
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: VN_TZ });

/** Current instant (wall-clock comparisons use VN-derived datetimes below) */
const nowVN = () => new Date();

const formatTimeVN = (d = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
};

const workDateToVNString = (workDate) => {
  if (!workDate) return '';
  const d = workDate instanceof Date ? workDate : new Date(workDate);
  return d.toLocaleDateString('en-CA', { timeZone: VN_TZ });
};

const addDaysToDateStr = (dateStr, days) => {
  const base = new Date(`${dateStr}T12:00:00${VN_OFFSET}`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toLocaleDateString('en-CA', { timeZone: VN_TZ });
};

/**
 * Builds a Date for workDate + HH:mm interpreted in Vietnam (UTC+7).
 */
const buildTaskDateTime = (workDateStr, hhmm) => {
  if (!DATE_REGEX.test(workDateStr)) throw new Error('date must be YYYY-MM-DD');
  const minutes = toMinutes(hhmm);
  if (minutes === null) throw new Error('time must be HH:mm');
  const [h, m] = hhmm.trim().split(':');
  return new Date(`${workDateStr}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:00${VN_OFFSET}`);
};

const getShiftStartDateTime = (workDateStr, startTime) => buildTaskDateTime(workDateStr, startTime);

/**
 * Shift end instant in VN. Overnight shifts end on the next calendar day.
 */
const getShiftEndDateTime = (workDateStr, startTime, endTime) => {
  const startMinutes = toMinutes(startTime);
  const endMinutes = toMinutes(endTime);
  if (startMinutes === null || endMinutes === null) {
    throw new Error('invalid shift times');
  }
  const endDateStr =
    endMinutes <= startMinutes ? addDaysToDateStr(workDateStr, 1) : workDateStr;
  return buildTaskDateTime(endDateStr, endTime);
};

const isShiftEnded = (workDateStr, startTime, endTime, now = nowVN()) =>
  getShiftEndDateTime(workDateStr, startTime, endTime) <= now;

const UNCONFIRMED_AUTO_CANCEL_GRACE_MS = 30 * 60 * 1000;
const POST_SHIFT_COMPLETE_GRACE_MS = 15 * 60 * 1000;

const getPostShiftCompleteDeadline = (workDateStr, startTime, endTime) =>
  new Date(getShiftEndDateTime(workDateStr, startTime, endTime).getTime() + POST_SHIFT_COMPLETE_GRACE_MS);

const isWithinPostShiftCompleteWindow = (workDateStr, startTime, endTime, now = nowVN()) => {
  const end = getShiftEndDateTime(workDateStr, startTime, endTime);
  const deadline = getPostShiftCompleteDeadline(workDateStr, startTime, endTime);
  return now >= end && now <= deadline;
};

const isPastPostShiftCompleteDeadline = (workDateStr, startTime, endTime, now = nowVN()) =>
  now > getPostShiftCompleteDeadline(workDateStr, startTime, endTime);

const isPastUnconfirmedCancelDeadline = (workDateStr, startTime, now = nowVN()) => {
  const deadline = new Date(
    getShiftStartDateTime(workDateStr, startTime).getTime() + UNCONFIRMED_AUTO_CANCEL_GRACE_MS
  );
  return deadline <= now;
};

module.exports = {
  VN_TZ,
  toMinutes,
  isShiftActiveNow,
  parseWorkDate,
  getLocalDateString,
  todayVN,
  nowVN,
  formatTimeVN,
  workDateToVNString,
  buildTaskDateTime,
  getShiftStartDateTime,
  getShiftEndDateTime,
  isShiftEnded,
  UNCONFIRMED_AUTO_CANCEL_GRACE_MS,
  POST_SHIFT_COMPLETE_GRACE_MS,
  isWithinPostShiftCompleteWindow,
  isPastPostShiftCompleteDeadline,
  isPastUnconfirmedCancelDeadline,
  addDaysToDateStr,
};

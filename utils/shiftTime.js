const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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

module.exports = {
  toMinutes,
  isShiftActiveNow,
  parseWorkDate,
  getLocalDateString,
};

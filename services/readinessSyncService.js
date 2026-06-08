const { getDatabase, isFirebaseEnabled, admin } = require('../config/firebaseAdmin');
const staffService = require('./staffService');
const { getLocalDateString } = require('../utils/shiftTime');

const workDateToYYYYMMDD = (workDate) => {
  if (!workDate) return null;
  if (typeof workDate === 'string' && workDate.length >= 10) return workDate.slice(0, 10);
  return new Date(workDate).toISOString().slice(0, 10);
};

const eachDateInRange = (startDate, endDate) => {
  const dates = [];
  const start = workDateToYYYYMMDD(startDate);
  const end = workDateToYYYYMMDD(endDate);
  if (!start || !end) return dates;

  const cur = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
};

const serializeForRtdb = (value) => JSON.parse(JSON.stringify(value));

const publishReadinessSnapshot = async (dateStr, options = {}) => {
  if (!isFirebaseEnabled()) return { skipped: true };

  const db = getDatabase();
  if (!db) return { skipped: true };

  const payload = await staffService.getAvailability({
    date: dateStr,
    role: options.role,
    floorId: options.floorId,
  });

  const staffMap = Object.fromEntries(
    payload.data.map((row) => [row._id.toString(), serializeForRtdb(row)])
  );

  const snapshot = {
    date: dateStr,
    checkedAt: payload.checkedAt
      ? new Date(payload.checkedAt).toISOString()
      : new Date().toISOString(),
    floorId: payload.floorId || null,
    summary: payload.summary,
    staff: staffMap,
    updatedAt: admin.database.ServerValue.TIMESTAMP,
  };

  await db.ref(`emergencyReadiness/${dateStr}`).set(snapshot);
  return { published: true, date: dateStr, staffCount: payload.data.length };
};

const publishTodayReadiness = (options = {}) => {
  const today = getLocalDateString();
  return publishReadinessSnapshot(today, options);
};

const triggerReadinessSync = (dateStr, options = {}) => {
  if (!dateStr || !isFirebaseEnabled()) return;
  publishReadinessSnapshot(dateStr, options).catch((err) =>
    console.warn(`[readinessSync] Failed for ${dateStr}:`, err.message)
  );
};

const triggerReadinessSyncForRange = (startDate, endDate, options = {}) => {
  for (const dateStr of eachDateInRange(startDate, endDate)) {
    triggerReadinessSync(dateStr, options);
  }
};

const triggerReadinessSyncForWorkDate = (workDate, options = {}) => {
  const dateStr = workDateToYYYYMMDD(workDate);
  triggerReadinessSync(dateStr, options);
};

module.exports = {
  publishReadinessSnapshot,
  publishTodayReadiness,
  triggerReadinessSync,
  triggerReadinessSyncForRange,
  triggerReadinessSyncForWorkDate,
  workDateToYYYYMMDD,
};

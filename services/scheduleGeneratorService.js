const medicationScheduleRepo = require('../repositories/medicationScheduleRepository');

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// Convert a Date to YYYY-MM-DD in Vietnam local time (UTC+7)
const toVNDateStr = (date) => {
  const vn = new Date(date.getTime() + VN_OFFSET_MS);
  return vn.toISOString().slice(0, 10);
};

/**
 * Delete future PENDING schedules for one item and recreate from item.times[].
 * Times are stored as "HH:MM" in Vietnam time (UTC+7); converted to UTC for storage.
 */
const generateSchedulesForItem = async (prescription, item) => {
  const now = new Date();

  await medicationScheduleRepo.deleteManyByFilter({
    prescriptionId: prescription._id,
    prescriptionItemId: item._id,
    status: 'PENDING',
    scheduledTime: { $gt: now },
  });

  if (!item.startDate || !item.endDate || !Array.isArray(item.times) || !item.times.length) return;

  const schedules = [];
  const startStr = toVNDateStr(new Date(item.startDate));
  const endStr = toVNDateStr(new Date(item.endDate));

  const cursor = new Date(`${startStr}T00:00:00+07:00`);
  const endDate = new Date(`${endStr}T00:00:00+07:00`);

  while (cursor <= endDate) {
    const dateStr = toVNDateStr(cursor);
    for (const timeStr of item.times) {
      const scheduledTime = new Date(`${dateStr}T${timeStr}:00+07:00`);
      if (scheduledTime > now) {
        schedules.push({
          residentId: prescription.residentId,
          prescriptionId: prescription._id,
          prescriptionItemId: item._id,
          medicationName: item.medicationName,
          dosage: item.dosage,
          route: item.route,
          scheduledTime,
          status: 'PENDING',
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  if (schedules.length) await medicationScheduleRepo.insertMany(schedules);
};

/**
 * Bulk-create schedules for all active items in a prescription.
 * Intended for initial creation; skips items without startDate/endDate/times.
 */
const generateSchedules = async (prescription) => {
  const now = new Date();
  const bulk = [];

  for (const item of prescription.items) {
    if (!item.isActive || item.isPRN || !item.startDate || !item.endDate || !item.times?.length) continue;

    const startStr = toVNDateStr(new Date(item.startDate));
    const endStr = toVNDateStr(new Date(item.endDate));

    const cursor = new Date(`${startStr}T00:00:00+07:00`);
    const endDate = new Date(`${endStr}T00:00:00+07:00`);

    while (cursor <= endDate) {
      const dateStr = toVNDateStr(cursor);
      for (const timeStr of item.times) {
        const scheduledTime = new Date(`${dateStr}T${timeStr}:00+07:00`);
        if (scheduledTime > now) {
          bulk.push({
            residentId: prescription.residentId,
            prescriptionId: prescription._id,
            prescriptionItemId: item._id,
            medicationName: item.medicationName,
            dosage: item.dosage,
            route: item.route,
            scheduledTime,
            status: 'PENDING',
          });
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  if (bulk.length) await medicationScheduleRepo.insertMany(bulk);
};

module.exports = { generateSchedules, generateSchedulesForItem };

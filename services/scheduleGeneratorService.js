const MedicationSchedule = require('../models/MedicationSchedule');

/**
 * Delete future PENDING schedules for one item and recreate from item.times[].
 * Times are stored as "HH:MM" in Vietnam time (UTC+7); converted to UTC for storage.
 */
const generateSchedulesForItem = async (prescription, item) => {
  const now = new Date();

  await MedicationSchedule.deleteMany({
    prescriptionId: prescription._id,
    prescriptionItemId: item._id,
    status: 'PENDING',
    scheduledTime: { $gt: now },
  });

  if (!item.startDate || !item.endDate || !Array.isArray(item.times) || !item.times.length) return;

  const schedules = [];
  const end = new Date(item.endDate);

  for (let d = new Date(item.startDate); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
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
  }

  if (schedules.length) await MedicationSchedule.insertMany(schedules);
};

/**
 * Bulk-create schedules for all active items in a prescription.
 * Intended for initial creation; skips items without startDate/endDate/times.
 */
const generateSchedules = async (prescription) => {
  const now = new Date();
  const bulk = [];

  for (const item of prescription.items) {
    if (!item.isActive || !item.startDate || !item.endDate || !item.times?.length) continue;

    const end = new Date(item.endDate);
    for (let d = new Date(item.startDate); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
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
    }
  }

  if (bulk.length) await MedicationSchedule.insertMany(bulk);
};

module.exports = { generateSchedules, generateSchedulesForItem };

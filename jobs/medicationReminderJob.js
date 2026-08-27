const cron = require('node-cron');
const medicationScheduleRepo = require('../repositories/medicationScheduleRepository');
const prescriptionRepo = require('../repositories/prescriptionRepository');
const notificationRepo = require('../repositories/notificationRepository');
const userRepo = require('../repositories/userRepository');
const notificationService = require('../services/notificationService');

const getNurseIds = async () => {
  const nurses = await userRepo.findStaffUsers({ role: 'nurse', isActive: true }, { skip: 0, limit: 10000 });
  return nurses.map((u) => u._id);
};

const buildNotification = (nurseId, title, content, scheduleId) => ({
  recipientUserId: nurseId,
  category: 'health',
  title,
  content,
  targetEntityType: 'MedicationSchedule',
  targetEntityId: scheduleId,
  deliveryChannels: ['in_app'],
});

const runUpcomingReminders = async () => {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 60 * 1000);

  const upcoming = await medicationScheduleRepo.findByFilter(
    { status: 'PENDING', scheduledTime: { $gt: now, $lte: in30 } },
    { populate: [{ path: 'residentId', select: 'fullName' }] }
  );

  if (!upcoming.length) return;

  const scheduleIds = upcoming.map((s) => s._id);
  const existingNotifs = await notificationRepo.findByFilter(
    { targetEntityType: 'MedicationSchedule', targetEntityId: { $in: scheduleIds }, title: 'Nhắc nhở uống thuốc' },
    'targetEntityId'
  );
  const alreadyNotified = new Set(existingNotifs.map((n) => n.targetEntityId.toString()));

  const toNotify = upcoming.filter((s) => !alreadyNotified.has(s._id.toString()));
  if (!toNotify.length) return;

  const nurseIds = await getNurseIds();
  if (!nurseIds.length) return;

  const notifications = [];
  for (const schedule of toNotify) {
    const residentName = schedule.residentId?.fullName || 'Unknown';
    const timeStr = schedule.scheduledTime.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    const content = `Nhắc nhở: ${residentName} cần uống ${schedule.medicationName} lúc ${timeStr}`;
    for (const nurseId of nurseIds) {
      notifications.push(buildNotification(nurseId, 'Nhắc nhở uống thuốc', content, schedule._id));
    }
  }

  if (notifications.length) await notificationService.createMany(notifications);
};

const runOverdueCheck = async () => {
  const threshold = new Date(Date.now() - 30 * 60 * 1000);

  const overdue = await medicationScheduleRepo.findByFilter(
    { status: 'PENDING', scheduledTime: { $lt: threshold } },
    { populate: [{ path: 'residentId', select: 'fullName' }] }
  );

  if (!overdue.length) return;

  const overdueIds = overdue.map((s) => s._id);
  await medicationScheduleRepo.updateManyByFilter(
    { _id: { $in: overdueIds } },
    { $set: { status: 'OVERDUE' } }
  );

  const nurseIds = await getNurseIds();
  if (!nurseIds.length) return;

  const notifications = [];
  for (const schedule of overdue) {
    const residentName = schedule.residentId?.fullName || 'Unknown';
    const timeStr = schedule.scheduledTime.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    const content = `Quá hạn: ${residentName} chưa uống ${schedule.medicationName} (lúc ${timeStr})`;
    for (const nurseId of nurseIds) {
      notifications.push(buildNotification(nurseId, 'Thuốc quá hạn chưa được uống', content, schedule._id));
    }
  }

  if (notifications.length) await notificationService.createMany(notifications);
};

const runAutoExpire = async () => {
  const now = new Date();
  const expiredPrescriptions = await prescriptionRepo.findByFilter({
    status: { $in: ['ACTIVE', 'SUSPENDED'] },
    validUntil: { $lt: now },
  });

  for (const rx of expiredPrescriptions) {
    rx.status = 'EXPIRED';
    rx.expiredAt = now;
    rx.editHistory.push({
      editedBy: rx.doctorId,
      editedAt: now,
      changes: 'Auto-expired: validUntil passed',
      action: 'AUTO_EXPIRE',
    });
    await prescriptionRepo.saveDoc(rx);

    await medicationScheduleRepo.updateManyByFilter(
      { prescriptionId: rx._id, status: { $in: ['PENDING', 'OVERDUE', 'HELD'] } },
      { $set: { status: 'DISCONTINUED' } }
    );
  }

  if (expiredPrescriptions.length) {
    console.log(`[MedicationJob] Auto-expired ${expiredPrescriptions.length} prescriptions`);
  }
};

const initMedicationJobs = () => {
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runUpcomingReminders();
    } catch (err) {
      console.error('[MedicationJob] Upcoming reminders error:', err.message);
    }
    try {
      await runOverdueCheck();
    } catch (err) {
      console.error('[MedicationJob] Overdue check error:', err.message);
    }
  });

  cron.schedule('0 * * * *', async () => {
    try {
      await runAutoExpire();
    } catch (err) {
      console.error('[MedicationJob] Auto-expire error:', err.message);
    }
  });

  console.log('[MedicationJob] Medication reminder jobs scheduled (every 15 min + hourly expiry)');
};

module.exports = { initMedicationJobs };

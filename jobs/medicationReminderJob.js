const cron = require('node-cron');
const MedicationSchedule = require('../models/MedicationSchedule');
const Notification = require('../models/notification');
const Resident = require('../models/resident');
const User = require('../models/user');

// Fetch all active nurse user IDs (cached per job run — not module-level to stay fresh)
const getNurseIds = async () => {
  const nurses = await User.find({ role: 'nurse', isActive: true }).select('_id');
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

/**
 * Job A — Upcoming reminder: PENDING schedules due within the next 30 minutes.
 * Runs every 15 minutes. Creates an in-app notification for each nurse.
 */
const runUpcomingReminders = async () => {
  const now = new Date();
  const in15 = new Date(now.getTime() + 15 * 60 * 1000);
  const in30 = new Date(now.getTime() + 30 * 60 * 1000);

  const upcoming = await MedicationSchedule.find({
    status: 'PENDING',
    scheduledTime: { $gt: now, $lte: in30 },
  }).populate('residentId', 'fullName');

  if (!upcoming.length) return;

  const scheduleIds = upcoming.map((s) => s._id);
  const existingNotifs = await Notification.find({
    targetEntityType: 'MedicationSchedule',
    targetEntityId: { $in: scheduleIds },
    title: 'Nhắc nhở uống thuốc',
  }).select('targetEntityId');
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
    const title = 'Nhắc nhở uống thuốc';
    for (const nurseId of nurseIds) {
      notifications.push(buildNotification(nurseId, title, content, schedule._id));
    }
  }

  if (notifications.length) await Notification.insertMany(notifications);
};

/**
 * Job B — Overdue: PENDING schedules whose scheduledTime is more than 30 minutes ago.
 * Runs every 15 minutes. Marks as OVERDUE and notifies all nurses.
 */
const runOverdueCheck = async () => {
  const threshold = new Date(Date.now() - 30 * 60 * 1000);

  const overdue = await MedicationSchedule.find({
    status: 'PENDING',
    scheduledTime: { $lt: threshold },
  }).populate('residentId', 'fullName');

  if (!overdue.length) return;

  const overdueIds = overdue.map((s) => s._id);
  await MedicationSchedule.updateMany(
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
    const title = 'Thuốc quá hạn chưa được uống';
    for (const nurseId of nurseIds) {
      notifications.push(buildNotification(nurseId, title, content, schedule._id));
    }
  }

  if (notifications.length) await Notification.insertMany(notifications);
};

const initMedicationJobs = () => {
  // Every 15 minutes
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

  console.log('[MedicationJob] Medication reminder jobs scheduled (every 15 min)');
};

module.exports = { initMedicationJobs };

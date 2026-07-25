const careAppointmentRepo = require('../repositories/careAppointmentRepository');
const notificationService = require('./notificationService');

const VN_TZ = 'Asia/Ho_Chi_Minh';

const formatTime = (date) =>
  date.toLocaleString('vi-VN', {
    timeZone: VN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

const processReminders = async () => {
  const hoursBefore = Math.max(1, parseInt(process.env.REMINDER_HOURS_BEFORE || '24', 10));
  const now = new Date();
  const windowEnd = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000);

  let appointments;
  try {
    appointments = await careAppointmentRepo.findAppointmentsNeedingReminder(now, windowEnd);
  } catch (err) {
    console.error('[ReminderScheduler] Failed to fetch appointments:', err.message);
    return;
  }

  if (!appointments.length) return;

  console.log(`[ReminderScheduler] Processing ${appointments.length} appointment(s)...`);

  for (const appointment of appointments) {
    try {
      const recipientIds = new Set();

      if (appointment.doctorStaffId?.userId) {
        recipientIds.add(appointment.doctorStaffId.userId.toString());
      }
      if (appointment.nurseStaffId?.userId) {
        recipientIds.add(appointment.nurseStaffId.userId.toString());
      }
      if (appointment.residentId?.familyPortalAccountIds?.length) {
        appointment.residentId.familyPortalAccountIds.forEach((fid) =>
          recipientIds.add(fid.toString())
        );
      }

      // Mark sent even if no recipients, to avoid re-checking on every tick
      await careAppointmentRepo.markReminderSent(appointment._id);

      if (!recipientIds.size) continue;

      const residentName = appointment.residentId?.fullName || 'Resident';
      const startStr = formatTime(appointment.scheduledStartAt);
      const endStr = formatTime(appointment.scheduledEndAt);
      const typeLabel = appointment.appointmentType || 'Chung';

      const notifications = [...recipientIds].map((userId) => ({
        recipientUserId: userId,
        category: 'appointment',
        title: 'Nhắc lịch khám (tự động)',
        content: `Lịch khám cho ${residentName}: ${typeLabel} — từ ${startStr} đến ${endStr}.${
          appointment.notes ? ` Ghi chú: ${appointment.notes}` : ''
        }`,
        targetEntityType: 'CareAppointment',
        targetEntityId: appointment._id,
        deliveryChannels: ['in_app'],
      }));

      await notificationService.createMany(notifications);

      console.log(
        `[ReminderScheduler] Sent ${notifications.length} reminder(s) for appointment ${appointment._id}`
      );
    } catch (err) {
      console.error(
        `[ReminderScheduler] Failed for appointment ${appointment._id}:`,
        err.message
      );
    }
  }
};

const startReminderScheduler = () => {
  const intervalMinutes = Math.max(1, parseInt(process.env.REMINDER_INTERVAL_MINUTES || '15', 10));
  const hoursBefore = process.env.REMINDER_HOURS_BEFORE || '24';
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(
    `[ReminderScheduler] Started — check every ${intervalMinutes}min, remind ${hoursBefore}h before appointment`
  );

  processReminders();
  setInterval(processReminders, intervalMs);
};

module.exports = { startReminderScheduler, processReminders };

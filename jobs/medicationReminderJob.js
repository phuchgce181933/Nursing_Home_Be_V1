const cron = require('node-cron');
const medicationScheduleRepo = require('../repositories/medicationScheduleRepository');
const prescriptionRepo = require('../repositories/prescriptionRepository');
const notificationRepo = require('../repositories/notificationRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const notificationService = require('../services/notificationService');

const VN_TZ = 'Asia/Ho_Chi_Minh';
const DUE_TITLE = 'Đến giờ phát thuốc';
const OVERDUE_TITLE = 'Thuốc quá hạn chưa được thực hiện';

// Chỉ nhắc "đến giờ" cho lịch vừa đến hạn trong khoảng gần đây (không nhắc lại lịch quá cũ khi
// server vừa khởi động lại). Lịch trễ hơn ngưỡng dưới sẽ do luồng "quá hạn" xử lý.
const DUE_GRACE_MINUTES = Math.max(2, parseInt(process.env.MED_DUE_GRACE_MINUTES || '30', 10));
const OVERDUE_AFTER_MINUTES = Math.max(5, parseInt(process.env.MED_OVERDUE_AFTER_MINUTES || '30', 10));

const formatVNTime = (date) =>
  date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: VN_TZ });

// Người nhận nhắc thuốc được suy ra HOÀN TOÀN ở server: điều dưỡng đang hoạt động được phân công
// phụ trách cư dân đó (StaffProfile.assignedResidentIds). KHÔNG tin staffId do Mobile gửi. Một
// điều dưỡng không phụ trách cư dân sẽ KHÔNG nhận nhắc thuốc của cư dân đó (PART 6).
const getResponsibleNurseIds = async (residentId) => {
  const profiles = await staffProfileRepo.findByAssignedResidentId(residentId);
  return profiles
    .filter((p) => p.userId && p.userId.role === 'nurse' && p.userId.isActive !== false)
    .map((p) => String(p.userId._id));
};

// Chống trùng lặp mang tính XÁC ĐỊNH và bền qua restart: dựa trên bản ghi Notification đã tồn tại
// trong DB cho đúng bộ (lịch phát thuốc, người nhận, loại nhắc) — KHÔNG dùng Set trong bộ nhớ vì
// khởi động lại server sẽ mất trạng thái và bắn trùng (PART 9). Trả về danh sách cặp chưa từng gửi.
const filterUnnotified = async (title, pairs) => {
  const scheduleIds = [...new Set(pairs.map((p) => String(p.scheduleId)))];
  if (!scheduleIds.length) return [];
  const existing = await notificationRepo.findByFilter(
    { targetEntityType: 'MedicationSchedule', targetEntityId: { $in: scheduleIds }, title },
    'targetEntityId recipientUserId'
  );
  const seen = new Set(existing.map((n) => `${n.targetEntityId}:${n.recipientUserId}`));
  return pairs.filter((p) => !seen.has(`${p.scheduleId}:${p.recipientUserId}`));
};

// Xây danh sách (lịch → điều dưỡng phụ trách) một lần, kèm cache người nhận theo cư dân để tránh
// truy vấn lặp khi nhiều lịch cùng một cư dân.
const buildRecipientPairs = async (schedules) => {
  const nurseCache = new Map();
  const pairs = [];
  for (const schedule of schedules) {
    const residentId = String(schedule.residentId?._id || schedule.residentId);
    if (!nurseCache.has(residentId)) {
      nurseCache.set(residentId, await getResponsibleNurseIds(residentId));
    }
    for (const nurseId of nurseCache.get(residentId)) {
      pairs.push({ scheduleId: String(schedule._id), recipientUserId: nurseId, schedule });
    }
  }
  return pairs;
};

// Nhắc "đã đến giờ phát thuốc": lịch PENDING có scheduledTime đã tới (<= now) và còn trong cửa sổ
// ân hạn. Chạy mỗi phút để độ trễ tối đa ~1 phút so với giờ thuốc thật.
const runDueReminders = async () => {
  const now = new Date();
  const graceStart = new Date(now.getTime() - DUE_GRACE_MINUTES * 60 * 1000);

  const due = await medicationScheduleRepo.findByFilter(
    { status: 'PENDING', scheduledTime: { $gt: graceStart, $lte: now } },
    { populate: [{ path: 'residentId', select: 'fullName' }] }
  );
  if (!due.length) return;

  const pairs = await buildRecipientPairs(due);
  const toSend = await filterUnnotified(DUE_TITLE, pairs);
  if (!toSend.length) return;

  const notifications = toSend.map(({ recipientUserId, schedule }) => {
    const residentName = schedule.residentId?.fullName || 'cư dân';
    const timeStr = formatVNTime(schedule.scheduledTime);
    return {
      recipientUserId,
      category: 'health',
      title: DUE_TITLE,
      // Quyền riêng tư (PART 4/14): KHÔNG đưa tên thuốc/liều lượng vào nội dung để tránh lộ thông
      // tin y tế nhạy cảm trên màn hình khóa. Chỉ nêu giờ + tên cư dân + hành động cần thực hiện.
      content: `${timeStr} • ${residentName} — Đã đến giờ thực hiện lịch phát thuốc.`,
      targetEntityType: 'MedicationSchedule',
      targetEntityId: schedule._id,
      deliveryChannels: ['in_app', 'push'],
    };
  });

  await notificationService.createMany(notifications);
};

// Đánh dấu quá hạn + nhắc điều dưỡng phụ trách. Cũng scope theo cư dân (PART 6) và dedup (PART 9).
const runOverdueCheck = async () => {
  const threshold = new Date(Date.now() - OVERDUE_AFTER_MINUTES * 60 * 1000);

  const overdue = await medicationScheduleRepo.findByFilter(
    { status: 'PENDING', scheduledTime: { $lt: threshold } },
    { populate: [{ path: 'residentId', select: 'fullName' }] }
  );
  if (!overdue.length) return;

  await medicationScheduleRepo.updateManyByFilter(
    { _id: { $in: overdue.map((s) => s._id) } },
    { $set: { status: 'OVERDUE' } }
  );

  const pairs = await buildRecipientPairs(overdue);
  const toSend = await filterUnnotified(OVERDUE_TITLE, pairs);
  if (!toSend.length) return;

  const notifications = toSend.map(({ recipientUserId, schedule }) => {
    const residentName = schedule.residentId?.fullName || 'cư dân';
    const timeStr = formatVNTime(schedule.scheduledTime);
    return {
      recipientUserId,
      category: 'health',
      title: OVERDUE_TITLE,
      content: `${timeStr} • ${residentName} — Lịch phát thuốc chưa được thực hiện.`,
      targetEntityType: 'MedicationSchedule',
      targetEntityId: schedule._id,
      deliveryChannels: ['in_app', 'push'],
    };
  });

  await notificationService.createMany(notifications);
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
  // Mỗi phút: nhắc "đến giờ phát thuốc" (độ trễ tối đa ~1 phút so với giờ thuốc). Dedup ở tầng DB
  // đảm bảo một lịch/người nhận chỉ nhận đúng một lần dù cron chạy lặp mỗi phút.
  cron.schedule('* * * * *', async () => {
    try {
      await runDueReminders();
    } catch (err) {
      console.error('[MedicationJob] Due reminders error:', err.message);
    }
  });

  // Mỗi 15 phút: kiểm tra thuốc quá hạn.
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runOverdueCheck();
    } catch (err) {
      console.error('[MedicationJob] Overdue check error:', err.message);
    }
  });

  // Hàng giờ: tự hết hạn đơn thuốc.
  cron.schedule('0 * * * *', async () => {
    try {
      await runAutoExpire();
    } catch (err) {
      console.error('[MedicationJob] Auto-expire error:', err.message);
    }
  });

  console.log('[MedicationJob] Scheduled: due reminders (1 min), overdue (15 min), auto-expire (hourly)');
};

module.exports = { initMedicationJobs, runDueReminders, runOverdueCheck, runAutoExpire };

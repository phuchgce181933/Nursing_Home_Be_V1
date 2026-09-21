const { isValidObjectId } = require('mongoose');
const ServiceError = require('./serviceError');
const medicationScheduleRepo = require('../repositories/medicationScheduleRepository');
const prescriptionRepo = require('../repositories/prescriptionRepository');
const medicationRepo = require('../repositories/medicationRepository');
const { getResidentScope, isInScope } = require('./residentScopeHelper');
const { generateSchedulesForItem } = require('./scheduleGeneratorService');
const notificationService = require('./notificationService');

const residentRepo = require('../repositories/residentRepository');
const roomRepo = require('../repositories/roomRepository');
const userRepo = require('../repositories/userRepository');
const medicationDispenseRepo = require('../repositories/medicationDispenseRepository');

const MISSED_REASONS = ['refused', 'asleep', 'vomiting', 'hospitalized', 'other'];
const REFUSED_REASONS = ['patient_refused', 'side_effects', 'allergy_concern', 'other'];
const HELD_REASONS = ['vital_signs_abnormal', 'npo_order', 'pending_lab_results', 'doctor_order', 'other'];
const NOT_AVAILABLE_REASONS = ['out_of_stock', 'pharmacy_delay', 'supply_issue', 'other'];
const ONE_HOUR_MS = 60 * 60 * 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

const isValidDateStr = (str) =>
  typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str).getTime());

const getDayBounds = (dateStr) => ({
  start: new Date(`${dateStr}T00:00:00+07:00`),
  end: new Date(`${dateStr}T23:59:59.999+07:00`),
});

const getTodayVN = () => {
  const vnMs = Date.now() + 7 * 60 * 60 * 1000;
  return new Date(vnMs).toISOString().slice(0, 10);
};

const getScheduleDateVN = (scheduledTime) => {
  const vnMs = new Date(scheduledTime).getTime() + 7 * 60 * 60 * 1000;
  return new Date(vnMs).toISOString().slice(0, 10);
};

const ensureScheduleIsToday = (schedule) => {
  if (getScheduleDateVN(schedule.scheduledTime) !== getTodayVN()) {
    throw new ServiceError('Chỉ được thao tác với lịch thuốc trong ngày hiện tại', 400);
  }
};

const isoWeekKey = (utcDate) => {
  const vn = new Date(utcDate.getTime() + 7 * 60 * 60 * 1000);
  const d = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
};

const notifyDoctorOfSchedule = async (schedule, prescription, eventLabel) => {
  try {
    const doctorId = prescription?.doctorId;
    if (!doctorId) return;

    const [doctor, resident] = await Promise.all([
      userRepo.findById(doctorId),
      residentRepo.findById(schedule.residentId),
    ]);
    if (!doctor) return;

    const residentName = resident?.fullName || 'bệnh nhân';
    const timeStr = schedule.scheduledTime.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    let content = `${residentName} đã ${eventLabel} thuốc ${schedule.medicationName} (lịch ${timeStr}).`;
    if (schedule.notes) content += ` Ghi chú: ${schedule.notes}`;
    if (schedule.missedReason) content += ` Lý do: ${schedule.missedReason}`;

    await notificationService.createMany([{
      recipientUserId: doctor._id,
      category: 'health',
      title: 'Cập nhật dùng thuốc',
      content,
      targetEntityType: 'MedicationSchedule',
      targetEntityId: schedule._id,
      deliveryChannels: ['in_app'],
    }]);
  } catch (err) {
    console.error('[Medication] Doctor notification failed (non-blocking):', err.message);
  }
};

const maybeCompletePrescriptionItem = async (prescription, prescriptionItemId, userId) => {
  if (!prescription) return;
  const item = prescription.items.id(prescriptionItemId);
  if (!item || !item.isActive) return;

  const remaining = await medicationScheduleRepo.countByFilter({
    prescriptionId: prescription._id,
    prescriptionItemId,
    status: { $in: ['PENDING', 'OVERDUE'] },
  });
  if (remaining > 0) return;

  item.isActive = false;
  prescription.editHistory.push({
    editedBy: userId,
    editedAt: new Date(),
    changes: `Auto-completed ${item.medicationName}: last dose recorded`,
  });

  if (prescription.status === 'ACTIVE' && prescription.items.every((i) => !i.isActive)) {
    prescription.status = 'COMPLETED';
    prescription.editHistory.push({
      editedBy: userId,
      editedAt: new Date(),
      changes: 'Auto-completed prescription: all medication items finished',
    });
  }

  await prescriptionRepo.saveDoc(prescription);
};

const autoDispense = async (medicationId, schedule, prescriptionId, residentId, userId, dosageStr, notePrefix) => {
  if (!medicationId) return;
  try {
    let qty = 1;
    if (dosageStr) {
      const m = String(dosageStr).trim().match(/^\s*([0-9]+(?:\.[0-9]+)?)/);
      if (m) qty = Number(m[1]) || 1;
    }
    await medicationDispenseRepo.create({
      medicationId,
      prescriptionId,
      residentId,
      quantity: qty,
      dispensedByUserId: userId,
      dispensedAt: new Date(),
      notes: `${notePrefix}: ${schedule.medicationName} (schedule ${schedule._id})`,
    });
  } catch (err) {
    console.error(`${notePrefix} auto-dispense failed (non-blocking):`, err.message);
  }
};

// ── getAvailableMedications ──────────────────────────────────────────────────

const getAvailableMedications = async ({ query }) => {
  const { search, page = 1, limit = 50 } = query;

  const filter = { isActive: true };
  if (search) {
    const term = String(search).trim();
    filter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { medicationCode: { $regex: term, $options: 'i' } },
      { manufacturer: { $regex: term, $options: 'i' } },
    ];
  }

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * limitNum;

  const [data, total] = await Promise.all([
    medicationRepo.findAll(filter, { sort: { name: 1 }, skip, limit: limitNum }),
    medicationRepo.countAll(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) || 1 };
};

// ── getCurrentMedications ────────────────────────────────────────────────────

const getCurrentMedications = async ({ query, user }) => {
  const { residentId } = query;

  if (!residentId) throw new ServiceError('residentId là tham số bắt buộc trong query', 400);
  if (!isValidObjectId(residentId)) throw new ServiceError('residentId phải là ObjectId hợp lệ', 400);

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(residentId, scope)) {
    throw new ServiceError('Cư dân không được phân công cho bạn', 403);
  }

  const resident = await residentRepo.findById(residentId);
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);

  const prescriptions = await prescriptionRepo.findAll(
    { residentId, status: 'ACTIVE' },
    { sort: { prescriptionDate: -1 }, skip: 0, limit: 1000 }
  );

  const medications = [];
  for (const rx of prescriptions) {
    for (const item of rx.items) {
      if (!item.isActive) continue;
      medications.push({
        _itemId: item._id,
        prescriptionId: rx._id,
        prescriptionDate: rx.prescriptionDate,
        validUntil: rx.validUntil,
        diagnosisNote: rx.diagnosisNote,
        prescribedBy: rx.doctorId?.fullName || null,
        medicationId: item.medicationId,
        medicationName: item.medicationName,
        genericName: item.genericName || null,
        dosage: item.dosage,
        unit: item.unit || null,
        frequency: item.frequency,
        times: item.times,
        route: item.route,
        duration: item.duration || null,
        startDate: item.startDate || null,
        endDate: item.endDate || null,
        instructions: item.instructions || null,
        elderlyDosageAdjusted: item.elderlyDosageAdjusted,
      });
    }
  }

  return {
    residentId,
    residentName: resident.fullName,
    totalMedications: medications.length,
    medications,
  };
};

// ── setMedicationSchedule ────────────────────────────────────────────────────

const setMedicationSchedule = async ({ body, user }) => {
  const { prescriptionId, items } = body;

  if (!prescriptionId || !isValidObjectId(prescriptionId)) {
    throw new ServiceError('prescriptionId phải là ObjectId hợp lệ', 400);
  }
  if (!Array.isArray(items) || !items.length) {
    throw new ServiceError('items phải là một mảng không rỗng', 400);
  }

  const prescription = await prescriptionRepo.findById(prescriptionId);
  if (!prescription) throw new ServiceError('Không tìm thấy đơn thuốc', 404);
  if (prescription.status !== 'ACTIVE') {
    throw new ServiceError('Chỉ có thể lên lịch cho đơn thuốc đang hoạt động (ACTIVE)', 400);
  }

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(prescription.residentId, scope)) {
    throw new ServiceError('Cư dân không được phân công cho bạn', 403);
  }

  for (const patch of items) {
    if (!patch.prescriptionItemId || !isValidObjectId(patch.prescriptionItemId)) {
      throw new ServiceError('Mỗi item phải có prescriptionItemId hợp lệ', 400);
    }
    const existing = prescription.items.id(patch.prescriptionItemId);
    if (!existing) {
      throw new ServiceError(`Không tìm thấy prescriptionItemId ${patch.prescriptionItemId} trong đơn thuốc này`, 400);
    }
    if (patch.times !== undefined) {
      if (!Array.isArray(patch.times) || patch.times.length !== existing.frequency) {
        throw new ServiceError(`times của ${existing.medicationName} phải có đúng ${existing.frequency} mục`, 400);
      }
      const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!patch.times.every((t) => timeRegex.test(t))) {
        throw new ServiceError('Các mục times phải đúng định dạng HH:MM (ví dụ "08:00")', 400);
      }
    }
    if (patch.startDate && !isValidDateStr(patch.startDate)) {
      throw new ServiceError('startDate phải đúng định dạng YYYY-MM-DD', 400);
    }
    if (patch.endDate && !isValidDateStr(patch.endDate)) {
      throw new ServiceError('endDate phải đúng định dạng YYYY-MM-DD', 400);
    }
    const effectiveStart = patch.startDate ? new Date(patch.startDate) : existing.startDate;
    const effectiveEnd = patch.endDate ? new Date(patch.endDate) : existing.endDate;
    if (effectiveStart && effectiveEnd && effectiveEnd <= effectiveStart) {
      throw new ServiceError(`endDate phải sau startDate đối với ${existing.medicationName}`, 400);
    }
    if (effectiveEnd && effectiveEnd > prescription.validUntil) {
      throw new ServiceError(
        `endDate của ${existing.medicationName} không được sau ngày hết hạn đơn thuốc (validUntil) (${prescription.validUntil.toISOString().slice(0, 10)})`,
        400
      );
    }
  }

  const changeLog = [];
  const rescheduledItems = [];

  for (const patch of items) {
    const item = prescription.items.id(patch.prescriptionItemId);
    const changes = [];
    if (patch.startDate !== undefined) { item.startDate = new Date(patch.startDate); changes.push(`startDate=${patch.startDate}`); }
    if (patch.endDate !== undefined)   { item.endDate   = new Date(patch.endDate);   changes.push(`endDate=${patch.endDate}`); }
    if (patch.times !== undefined)     { item.times     = patch.times;               changes.push(`times=[${patch.times.join(',')}]`); }
    if (changes.length) {
      changeLog.push(`Set schedule for ${item.medicationName}: ${changes.join(', ')}`);
      rescheduledItems.push(item);
    }
  }

  if (!changeLog.length) {
    return { noChanges: true, data: prescription };
  }

  prescription.editHistory.push({ editedBy: user._id, editedAt: new Date(), changes: changeLog.join('; ') });
  await prescriptionRepo.saveDoc(prescription);

  let schedulesCreated = 0;
  for (const item of rescheduledItems) {
    const before = await medicationScheduleRepo.countByFilter({
      prescriptionId: prescription._id,
      prescriptionItemId: item._id,
      status: 'PENDING',
      scheduledTime: { $gt: new Date() },
    });
    await generateSchedulesForItem(prescription, item);
    const after = await medicationScheduleRepo.countByFilter({
      prescriptionId: prescription._id,
      prescriptionItemId: item._id,
      status: 'PENDING',
      scheduledTime: { $gt: new Date() },
    });
    schedulesCreated += after - before;
  }

  const populated = await prescriptionRepo.findByIdListPopulated(prescription._id);

  return {
    noChanges: false,
    message: `Đã cập nhật lịch cho ${rescheduledItems.length} loại thuốc, tạo mới ${schedulesCreated} khung giờ`,
    data: populated,
  };
};

// ── getDailySchedule ─────────────────────────────────────────────────────────

const getDailySchedule = async ({ query, user }) => {
  const { date = getTodayVN(), residentId, wardId, status } = query;

  if (!isValidDateStr(date)) throw new ServiceError('date phải đúng định dạng YYYY-MM-DD', 400);

  const scope = await getResidentScope(user._id, user.role);
  const { start, end } = getDayBounds(date);
  const scheduleFilter = { scheduledTime: { $gte: start, $lte: end } };
  if (status && status.toUpperCase() !== 'ALL') scheduleFilter.status = status;

  if (residentId) {
    if (!isValidObjectId(residentId)) throw new ServiceError('residentId phải là ObjectId hợp lệ', 400);
    if (!isInScope(residentId, scope)) throw new ServiceError('Cư dân không được phân công cho bạn', 403);
    scheduleFilter.residentId = residentId;
  } else if (wardId) {
    if (!isValidObjectId(wardId)) throw new ServiceError('wardId phải là ObjectId hợp lệ', 400);
    const rooms = await roomRepo.findByFilterLean({ floorId: wardId }, { select: '_id' });
    const roomIds = rooms.map((r) => r._id);
    let residents = await residentRepo.findByFilterLean({ roomId: { $in: roomIds } }, { select: '_id' });
    if (scope !== null) {
      residents = residents.filter((r) => scope.includes(r._id.toString()));
    }
    if (!residents.length) return { date, data: [] };
    scheduleFilter.residentId = { $in: residents.map((r) => r._id) };
  } else if (scope !== null) {
    if (!scope.length) return { date, data: [] };
    scheduleFilter.residentId = { $in: scope };
  }

  const schedules = await medicationScheduleRepo.findByFilter(scheduleFilter, {
    sort: { scheduledTime: 1 },
    populate: [
      { path: 'residentId', select: 'fullName roomId', populate: { path: 'roomId', select: 'roomNumber' } },
      { path: 'markedBy', select: 'fullName role' },
    ],
  });

  const grouped = new Map();
  for (const s of schedules) {
    const resident = s.residentId;
    if (!resident) continue;
    const key = resident._id.toString();
    if (!grouped.has(key)) {
      grouped.set(key, {
        residentId: key,
        residentName: resident.fullName,
        room: resident.roomId?.roomNumber || null,
        schedules: [],
      });
    }
    grouped.get(key).schedules.push({
      id: s._id,
      prescriptionId: s.prescriptionId,
      medicationName: s.medicationName,
      dosage: s.dosage,
      route: s.route,
      scheduledTime: s.scheduledTime,
      status: s.status,
      markedBy: s.markedBy || null,
      markedAt: s.markedAt || null,
      actualTimeTaken: s.actualTimeTaken || null,
      administrationTiming: s.administrationTiming || null,
      missedReason: s.missedReason || null,
      notes: s.notes || null,
    });
  }

  return { date, data: [...grouped.values()] };
};

// ── getSchedules ─────────────────────────────────────────────────────────────

const getSchedules = async ({ query, user }) => {
  const { residentId, date, status } = query;

  if (!residentId) throw new ServiceError('residentId là tham số bắt buộc trong query', 400);
  if (!isValidObjectId(residentId)) throw new ServiceError('residentId phải là ObjectId hợp lệ', 400);
  if (date && !isValidDateStr(date)) throw new ServiceError('date phải đúng định dạng YYYY-MM-DD', 400);

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(residentId, scope)) throw new ServiceError('Cư dân không được phân công cho bạn', 403);

  const filter = { residentId };
  if (status && status.toUpperCase() !== 'ALL') filter.status = status;
  if (date) {
    const { start, end } = getDayBounds(date);
    filter.scheduledTime = { $gte: start, $lte: end };
  }

  const schedules = await medicationScheduleRepo.findByFilter(filter, {
    sort: { scheduledTime: 1 },
    populate: [{ path: 'markedBy', select: 'fullName role' }],
  });

  return schedules;
};

// ── markTaken ────────────────────────────────────────────────────────────────

const markTaken = async ({ id, body, user }) => {
  if (!isValidObjectId(id)) throw new ServiceError('ID lịch không hợp lệ', 400);

  const { actualTimeTaken, notes } = body;

  const schedule = await medicationScheduleRepo.findById(id);
  if (!schedule) throw new ServiceError('Không tìm thấy lịch', 404);
  ensureScheduleIsToday(schedule);

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(schedule.residentId, scope)) throw new ServiceError('Cư dân không được phân công cho bạn', 403);

  if (!['PENDING', 'OVERDUE'].includes(schedule.status)) {
    throw new ServiceError(`Không thể đánh dấu đã dùng: trạng thái hiện tại là ${schedule.status}`, 400);
  }

  const prescription = await prescriptionRepo.findById(schedule.prescriptionId);
  const prescriptionItem = prescription?.items?.id(schedule.prescriptionItemId);
  const medicationId = prescriptionItem?.medicationId;

  const takenAt = actualTimeTaken ? new Date(actualTimeTaken) : new Date();
  if (isNaN(takenAt.getTime())) throw new ServiceError('actualTimeTaken phải là ngày ISO hợp lệ', 400);

  const diffMs = takenAt.getTime() - schedule.scheduledTime.getTime();
  const late = diffMs > ONE_HOUR_MS;
  schedule.administrationTiming = diffMs < 0 ? 'early' : late ? 'late' : 'on_time';
  schedule.status = late ? 'LATE_TAKEN' : 'TAKEN';
  schedule.markedBy = user._id;
  schedule.markedAt = new Date();
  schedule.actualTimeTaken = takenAt;
  if (notes !== undefined) schedule.notes = notes;

  await medicationScheduleRepo.saveDoc(schedule);

  const takenEventLabel =
    schedule.administrationTiming === 'early' ? 'dùng thuốc sớm'
      : schedule.administrationTiming === 'late' ? 'dùng thuốc muộn'
      : 'dùng thuốc';
  await notifyDoctorOfSchedule(schedule, prescription, takenEventLabel);

  const rawDosage = prescriptionItem?.dosage || schedule.dosage || '';
  await autoDispense(medicationId, schedule, schedule.prescriptionId, schedule.residentId, user._id, rawDosage, 'Auto-dispensed');

  await maybeCompletePrescriptionItem(prescription, schedule.prescriptionItemId, user._id);

  await schedule.populate('markedBy', 'fullName role');
  return schedule;
};

// ── markMissed ───────────────────────────────────────────────────────────────

const markMissed = async ({ id, body, user }) => {
  if (!isValidObjectId(id)) throw new ServiceError('ID lịch không hợp lệ', 400);

  const { reason, notes } = body;
  if (!reason || !MISSED_REASONS.includes(reason)) {
    throw new ServiceError(`reason là bắt buộc và phải thuộc một trong: ${MISSED_REASONS.join(', ')}`, 400);
  }

  const schedule = await medicationScheduleRepo.findById(id);
  if (!schedule) throw new ServiceError('Không tìm thấy lịch', 404);
  ensureScheduleIsToday(schedule);

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(schedule.residentId, scope)) throw new ServiceError('Cư dân không được phân công cho bạn', 403);

  if (!['PENDING', 'OVERDUE'].includes(schedule.status)) {
    throw new ServiceError(`Không thể đánh dấu bỏ lỡ: trạng thái hiện tại là ${schedule.status}`, 400);
  }

  schedule.status = 'MISSED';
  schedule.markedBy = user._id;
  schedule.markedAt = new Date();
  schedule.missedReason = reason;
  if (notes !== undefined) schedule.notes = notes;

  await medicationScheduleRepo.saveDoc(schedule);

  const prescription = await prescriptionRepo.findById(schedule.prescriptionId);
  await notifyDoctorOfSchedule(schedule, prescription, 'bỏ lỡ liều');
  await maybeCompletePrescriptionItem(prescription, schedule.prescriptionItemId, user._id);

  await schedule.populate('markedBy', 'fullName role');
  return schedule;
};

// ── markRefused ──────────────────────────────────────────────────────────────

const markRefused = async ({ id, body, user }) => {
  if (!isValidObjectId(id)) throw new ServiceError('ID lịch không hợp lệ', 400);

  const { reason, notes } = body;
  if (!reason || !REFUSED_REASONS.includes(reason)) {
    throw new ServiceError(`reason là bắt buộc và phải thuộc một trong: ${REFUSED_REASONS.join(', ')}`, 400);
  }

  const schedule = await medicationScheduleRepo.findById(id);
  if (!schedule) throw new ServiceError('Không tìm thấy lịch', 404);
  ensureScheduleIsToday(schedule);

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(schedule.residentId, scope)) throw new ServiceError('Cư dân không được phân công cho bạn', 403);

  if (!['PENDING', 'OVERDUE'].includes(schedule.status)) {
    throw new ServiceError(`Không thể đánh dấu từ chối: trạng thái hiện tại là ${schedule.status}`, 400);
  }

  schedule.status = 'REFUSED';
  schedule.markedBy = user._id;
  schedule.markedAt = new Date();
  schedule.refusedReason = reason;
  if (notes !== undefined) schedule.notes = notes;
  await medicationScheduleRepo.saveDoc(schedule);

  const prescription = await prescriptionRepo.findById(schedule.prescriptionId);
  await notifyDoctorOfSchedule(schedule, prescription, 'từ chối dùng thuốc');
  await maybeCompletePrescriptionItem(prescription, schedule.prescriptionItemId, user._id);
  await schedule.populate('markedBy', 'fullName role');

  return schedule;
};

// ── markHeld ─────────────────────────────────────────────────────────────────

const markHeld = async ({ id, body, user }) => {
  if (!isValidObjectId(id)) throw new ServiceError('ID lịch không hợp lệ', 400);

  const { reason, notes } = body;
  if (!reason || !HELD_REASONS.includes(reason)) {
    throw new ServiceError(`reason là bắt buộc và phải thuộc một trong: ${HELD_REASONS.join(', ')}`, 400);
  }

  const schedule = await medicationScheduleRepo.findById(id);
  if (!schedule) throw new ServiceError('Không tìm thấy lịch', 404);
  ensureScheduleIsToday(schedule);

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(schedule.residentId, scope)) throw new ServiceError('Cư dân không được phân công cho bạn', 403);

  if (!['PENDING', 'OVERDUE'].includes(schedule.status)) {
    throw new ServiceError(`Không thể giữ lại: trạng thái hiện tại là ${schedule.status}`, 400);
  }

  schedule.status = 'HELD';
  schedule.markedBy = user._id;
  schedule.markedAt = new Date();
  schedule.heldReason = reason;
  if (notes !== undefined) schedule.notes = notes;
  await medicationScheduleRepo.saveDoc(schedule);

  const prescription = await prescriptionRepo.findById(schedule.prescriptionId);
  await notifyDoctorOfSchedule(schedule, prescription, 'giữ lại thuốc');
  await schedule.populate('markedBy', 'fullName role');

  return schedule;
};

// ── markNotAvailable ─────────────────────────────────────────────────────────

const markNotAvailable = async ({ id, body, user }) => {
  if (!isValidObjectId(id)) throw new ServiceError('ID lịch không hợp lệ', 400);

  const { reason, notes } = body;
  if (!reason || !NOT_AVAILABLE_REASONS.includes(reason)) {
    throw new ServiceError(`reason là bắt buộc và phải thuộc một trong: ${NOT_AVAILABLE_REASONS.join(', ')}`, 400);
  }

  const schedule = await medicationScheduleRepo.findById(id);
  if (!schedule) throw new ServiceError('Không tìm thấy lịch', 404);
  ensureScheduleIsToday(schedule);

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(schedule.residentId, scope)) throw new ServiceError('Cư dân không được phân công cho bạn', 403);

  if (!['PENDING', 'OVERDUE'].includes(schedule.status)) {
    throw new ServiceError(`Không thể đánh dấu không có sẵn: trạng thái hiện tại là ${schedule.status}`, 400);
  }

  schedule.status = 'NOT_AVAILABLE';
  schedule.markedBy = user._id;
  schedule.markedAt = new Date();
  schedule.notAvailableReason = reason;
  if (notes !== undefined) schedule.notes = notes;
  await medicationScheduleRepo.saveDoc(schedule);

  const prescription = await prescriptionRepo.findById(schedule.prescriptionId);
  await notifyDoctorOfSchedule(schedule, prescription, 'thuốc không có sẵn');
  await schedule.populate('markedBy', 'fullName role');

  return schedule;
};

// ── administerPRN ────────────────────────────────────────────────────────────

const administerPRN = async ({ body, user }) => {
  const { prescriptionId, prescriptionItemId, notes, reason } = body;

  if (!prescriptionId || !isValidObjectId(prescriptionId)) {
    throw new ServiceError('prescriptionId phải là ObjectId hợp lệ', 400);
  }
  if (!prescriptionItemId || !isValidObjectId(prescriptionItemId)) {
    throw new ServiceError('prescriptionItemId phải là ObjectId hợp lệ', 400);
  }

  const prescription = await prescriptionRepo.findById(prescriptionId);
  if (!prescription) throw new ServiceError('Không tìm thấy đơn thuốc', 404);
  if (prescription.status !== 'ACTIVE') throw new ServiceError('Đơn thuốc phải ở trạng thái ACTIVE', 400);

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(prescription.residentId, scope)) throw new ServiceError('Cư dân không được phân công cho bạn', 403);

  const item = prescription.items.id(prescriptionItemId);
  if (!item || !item.isActive || !item.isPRN) {
    throw new ServiceError('Item không hợp lệ hoặc không phải PRN', 400);
  }

  if (item.maxDailyDoses) {
    const todayVN = getTodayVN();
    const { start, end } = getDayBounds(todayVN);
    const todayCount = await medicationScheduleRepo.countByFilter({
      prescriptionId: prescription._id,
      prescriptionItemId: item._id,
      isPRN: true,
      status: { $in: ['TAKEN', 'LATE_TAKEN'] },
      markedAt: { $gte: start, $lte: end },
    });
    if (todayCount >= item.maxDailyDoses) {
      const err = new ServiceError(`Đã đạt giới hạn ${item.maxDailyDoses} liều/ngày cho thuốc PRN này`, 400);
      err.todayCount = todayCount;
      err.maxDailyDoses = item.maxDailyDoses;
      throw err;
    }
  }

  const now = new Date();
  const schedule = await medicationScheduleRepo.create({
    residentId: prescription.residentId,
    prescriptionId: prescription._id,
    prescriptionItemId: item._id,
    medicationName: item.medicationName,
    dosage: item.dosage,
    route: item.route,
    scheduledTime: now,
    status: 'TAKEN',
    markedBy: user._id,
    markedAt: now,
    actualTimeTaken: now,
    administrationTiming: 'on_time',
    isPRN: true,
    prnReason: reason || item.prnReason,
    notes,
  });

  await autoDispense(item.medicationId, schedule, prescription._id, prescription.residentId, user._id, item.dosage, 'PRN administration');

  await notifyDoctorOfSchedule(schedule, prescription, 'dùng thuốc PRN');
  await schedule.populate('markedBy', 'fullName role');

  return schedule;
};

// ── getHistory ───────────────────────────────────────────────────────────────

const getHistory = async ({ query, user }) => {
  const { residentId, from, to, medicationName, prescriptionId } = query;

  if (!residentId) throw new ServiceError('residentId là tham số bắt buộc trong query', 400);
  if (!isValidObjectId(residentId)) throw new ServiceError('residentId phải là ObjectId hợp lệ', 400);
  if (prescriptionId && !isValidObjectId(prescriptionId)) throw new ServiceError('prescriptionId phải là ObjectId hợp lệ', 400);
  if (from && !isValidDateStr(from)) throw new ServiceError('from phải đúng định dạng YYYY-MM-DD', 400);
  if (to && !isValidDateStr(to)) throw new ServiceError('to phải đúng định dạng YYYY-MM-DD', 400);

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(residentId, scope)) throw new ServiceError('Cư dân không được phân công cho bạn', 403);

  const resident = await residentRepo.findById(residentId);
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);

  const filter = { residentId };
  if (prescriptionId) filter.prescriptionId = prescriptionId;
  if (from || to) {
    filter.scheduledTime = {};
    if (from) filter.scheduledTime.$gte = new Date(`${from}T00:00:00+07:00`);
    if (to) filter.scheduledTime.$lte = new Date(`${to}T23:59:59.999+07:00`);
  }
  if (medicationName) filter.medicationName = { $regex: medicationName, $options: 'i' };

  const records = await medicationScheduleRepo.findByFilter(filter, {
    sort: { scheduledTime: 1 },
    populate: [{ path: 'markedBy', select: 'fullName role' }],
  });

  let taken = 0, lateTaken = 0, missed = 0, skipped = 0;
  for (const r of records) {
    if (r.status === 'TAKEN') taken++;
    else if (r.status === 'LATE_TAKEN') lateTaken++;
    else if (r.status === 'MISSED') missed++;
    else if (r.status === 'SKIPPED') skipped++;
  }
  const denominator = taken + lateTaken + missed;
  const complianceRate = denominator > 0 ? Math.round(((taken + lateTaken) / denominator) * 1000) / 10 : null;

  const weeklyMap = new Map();
  for (const r of records) {
    const week = isoWeekKey(r.scheduledTime);
    if (!weeklyMap.has(week)) weeklyMap.set(week, { taken: 0, missed: 0 });
    const entry = weeklyMap.get(week);
    if (r.status === 'TAKEN' || r.status === 'LATE_TAKEN') entry.taken++;
    else if (r.status === 'MISSED') entry.missed++;
  }
  const weeklyCompliance = [...weeklyMap.entries()].map(([week, { taken: t, missed: m }]) => {
    const denom = t + m;
    return { week, rate: denom > 0 ? Math.round((t / denom) * 1000) / 10 : null };
  });

  return {
    residentId,
    residentName: resident.fullName,
    summary: { total: records.length, taken, lateTaken, missed, skipped, complianceRate },
    lowCompliance: complianceRate !== null && complianceRate < 80,
    records: records.map((r) => ({
      _id: r._id,
      date: r.scheduledTime.toISOString().slice(0, 10),
      medicationName: r.medicationName,
      dosage: r.dosage,
      route: r.route,
      scheduledTime: r.scheduledTime,
      actualTimeTaken: r.actualTimeTaken || null,
      status: r.status,
      markedBy: r.markedBy || null,
      markedAt: r.markedAt || null,
      notes: r.notes || null,
      missedReason: r.missedReason || null,
    })),
    weeklyCompliance,
  };
};

module.exports = {
  getAvailableMedications,
  getCurrentMedications,
  setMedicationSchedule,
  getDailySchedule,
  getSchedules,
  markTaken,
  markMissed,
  markRefused,
  markHeld,
  markNotAvailable,
  administerPRN,
  getHistory,
};

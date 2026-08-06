const { isValidObjectId } = require('mongoose');
const MedicationSchedule = require('../models/MedicationSchedule');
const Prescription = require('../models/prescription');
const Medication = require('../models/medication');
const MedicationDispense = require('../models/medicationDispense');
const Resident = require('../models/resident');
const Room = require('../models/room');
const StaffProfile = require('../models/staffProfile');
const User = require('../models/user');
const notificationService = require('../services/notificationService');
const { generateSchedulesForItem } = require('../services/scheduleGeneratorService');

const MISSED_REASONS = ['refused', 'asleep', 'vomiting', 'hospitalized', 'other'];
const ONE_HOUR_MS = 60 * 60 * 1000;

// Notify the prescribing doctor whenever a nurse marks a dose taken/late/missed.
// Best-effort: a notification failure must never block the medication record itself.
const notifyDoctorOfSchedule = async (schedule, prescription, eventLabel) => {
  try {
    const doctorId = prescription?.doctorId;
    if (!doctorId) return;

    const [doctor, resident] = await Promise.all([
      User.findById(doctorId).select('_id'),
      Resident.findById(schedule.residentId).select('fullName'),
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

// ── Scope helpers ─────────────────────────────────────────────────────────────

const getResidentScope = async (userId, role) => {
  if (['admin'].includes(role)) return null;
  const profile = await StaffProfile.findOne({ userId }).select('assignedResidentIds');
  if (!profile) return [];
  return profile.assignedResidentIds.map(String);
};

const isInScope = (residentId, scope) =>
  scope === null || scope.includes(String(residentId));

// When a medication item has no more PENDING/OVERDUE doses left (the last dose was
// just taken/missed), mark it done. If every item on the prescription is done, the
// whole prescription auto-completes.
const maybeCompletePrescriptionItem = async (prescription, prescriptionItemId, userId) => {
  if (!prescription) return;
  const item = prescription.items.id(prescriptionItemId);
  if (!item || !item.isActive) return;

  const remaining = await MedicationSchedule.countDocuments({
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

  await prescription.save();
};

// ── Validators ────────────────────────────────────────────────────────────────

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

// ISO week key in Vietnam local time: "YYYY-Www"
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

// ── GET /api/medications/available ───────────────────────────────────────────
// Lists active pharmacy medications for doctors to select when prescribing.
const getAvailableMedications = async (req, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;

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
      Medication.find(filter)
        .select('_id medicationCode name genericName form strength unit manufacturer description')
        .sort({ name: 1 })
        .skip(skip)
        .limit(limitNum),
      Medication.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/medications/current ─────────────────────────────────────────────
// Active medication items from ACTIVE prescriptions for one resident.
const getCurrentMedications = async (req, res) => {
  try {
    const { residentId } = req.query;

    if (!residentId) {
      return res.status(400).json({ success: false, message: 'residentId là tham số bắt buộc trong query' });
    }
    if (!isValidObjectId(residentId)) {
      return res.status(400).json({ success: false, message: 'residentId phải là ObjectId hợp lệ' });
    }

    // Scope check
    const scope = await getResidentScope(req.user._id, req.user.role);
    if (!isInScope(residentId, scope)) {
      return res.status(403).json({ success: false, message: 'Cư dân không được phân công cho bạn' });
    }

    const resident = await Resident.findById(residentId).select('fullName');
    if (!resident) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy cư dân' });
    }

    const prescriptions = await Prescription.find({ residentId, status: 'ACTIVE' })
      .populate('doctorId', 'fullName')
      .populate('items.medicationId', 'name medicationCode form strength unit')
      .sort({ prescriptionDate: -1 });

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

    return res.status(200).json({
      success: true,
      data: {
        residentId,
        residentName: resident.fullName,
        totalMedications: medications.length,
        medications,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/medications/schedule/set ────────────────────────────────────────
// Doctor sets startDate, endDate, times for prescription items → regenerates schedules.
const setMedicationSchedule = async (req, res) => {
  try {
    const { prescriptionId, items } = req.body;

    if (!prescriptionId || !isValidObjectId(prescriptionId)) {
      return res.status(400).json({ success: false, message: 'prescriptionId phải là ObjectId hợp lệ' });
    }
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: 'items phải là một mảng không rỗng' });
    }

    const prescription = await Prescription.findById(prescriptionId);
    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn thuốc' });
    }
    if (prescription.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, message: 'Chỉ có thể lên lịch cho đơn thuốc đang hoạt động (ACTIVE)' });
    }

    // Scope check
    const scope = await getResidentScope(req.user._id, req.user.role);
    if (!isInScope(prescription.residentId, scope)) {
      return res.status(403).json({ success: false, message: 'Cư dân không được phân công cho bạn' });
    }

    // Validate all patches before modifying anything
    for (const patch of items) {
      if (!patch.prescriptionItemId || !isValidObjectId(patch.prescriptionItemId)) {
        return res.status(400).json({ success: false, message: 'Mỗi item phải có prescriptionItemId hợp lệ' });
      }

      const existing = prescription.items.id(patch.prescriptionItemId);
      if (!existing) {
        return res.status(400).json({
          success: false,
          message: `Không tìm thấy prescriptionItemId ${patch.prescriptionItemId} trong đơn thuốc này`,
        });
      }

      if (patch.times !== undefined) {
        if (!Array.isArray(patch.times) || patch.times.length !== existing.frequency) {
          return res.status(400).json({
            success: false,
            message: `times của ${existing.medicationName} phải có đúng ${existing.frequency} mục`,
          });
        }
        const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
        if (!patch.times.every((t) => timeRegex.test(t))) {
          return res.status(400).json({ success: false, message: 'Các mục times phải đúng định dạng HH:MM (ví dụ "08:00")' });
        }
      }

      if (patch.startDate && !isValidDateStr(patch.startDate)) {
        return res.status(400).json({ success: false, message: 'startDate phải đúng định dạng YYYY-MM-DD' });
      }
      if (patch.endDate && !isValidDateStr(patch.endDate)) {
        return res.status(400).json({ success: false, message: 'endDate phải đúng định dạng YYYY-MM-DD' });
      }

      const effectiveStart = patch.startDate ? new Date(patch.startDate) : existing.startDate;
      const effectiveEnd = patch.endDate ? new Date(patch.endDate) : existing.endDate;

      if (effectiveStart && effectiveEnd && effectiveEnd <= effectiveStart) {
        return res.status(400).json({
          success: false,
          message: `endDate phải sau startDate đối với ${existing.medicationName}`,
        });
      }
      if (effectiveEnd && effectiveEnd > prescription.validUntil) {
        return res.status(400).json({
          success: false,
          message: `endDate của ${existing.medicationName} không được sau ngày hết hạn đơn thuốc (validUntil) (${prescription.validUntil.toISOString().slice(0, 10)})`,
        });
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
      return res.status(200).json({ success: true, message: 'Không có thay đổi lịch nào được phát hiện', data: prescription });
    }

    prescription.editHistory.push({ editedBy: req.user._id, editedAt: new Date(), changes: changeLog.join('; ') });
    await prescription.save();

    let schedulesCreated = 0;
    for (const item of rescheduledItems) {
      const before = await MedicationSchedule.countDocuments({
        prescriptionId: prescription._id,
        prescriptionItemId: item._id,
        status: 'PENDING',
        scheduledTime: { $gt: new Date() },
      });
      await generateSchedulesForItem(prescription, item);
      const after = await MedicationSchedule.countDocuments({
        prescriptionId: prescription._id,
        prescriptionItemId: item._id,
        status: 'PENDING',
        scheduledTime: { $gt: new Date() },
      });
      schedulesCreated += after - before;
    }

    const populated = await Prescription.findById(prescription._id)
      .populate('residentId', 'fullName dateOfBirth')
      .populate('doctorId', 'fullName')
      .populate('items.medicationId', 'name medicationCode form strength unit')
      .populate('editHistory.editedBy', 'fullName role');

    return res.status(200).json({
      success: true,
      message: `Đã cập nhật lịch cho ${rescheduledItems.length} loại thuốc, tạo mới ${schedulesCreated} khung giờ`,
      data: populated,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/medications/schedule/daily ──────────────────────────────────────

const getDailySchedule = async (req, res) => {
  try {
    const { date = getTodayVN(), residentId, wardId, status } = req.query;

    if (!isValidDateStr(date)) {
      return res.status(400).json({ success: false, message: 'date phải đúng định dạng YYYY-MM-DD' });
    }

    const scope = await getResidentScope(req.user._id, req.user.role);
    const { start, end } = getDayBounds(date);
    const scheduleFilter = { scheduledTime: { $gte: start, $lte: end } };
    if (status && status.toUpperCase() !== 'ALL') scheduleFilter.status = status;

    if (residentId) {
      if (!isValidObjectId(residentId)) {
        return res.status(400).json({ success: false, message: 'residentId phải là ObjectId hợp lệ' });
      }
      if (!isInScope(residentId, scope)) {
        return res.status(403).json({ success: false, message: 'Cư dân không được phân công cho bạn' });
      }
      scheduleFilter.residentId = residentId;
    } else if (wardId) {
      if (!isValidObjectId(wardId)) {
        return res.status(400).json({ success: false, message: 'wardId phải là ObjectId hợp lệ' });
      }
      const rooms = await Room.find({ floorId: wardId }).select('_id');
      const roomIds = rooms.map((r) => r._id);
      let residents = await Resident.find({ roomId: { $in: roomIds } }).select('_id');
      // Narrow to assigned residents if scoped
      if (scope !== null) {
        residents = residents.filter((r) => scope.includes(r._id.toString()));
      }
      if (!residents.length) {
        return res.status(200).json({ success: true, date, data: [] });
      }
      scheduleFilter.residentId = { $in: residents.map((r) => r._id) };
    } else if (scope !== null) {
      // No filter given — show only assigned residents
      if (!scope.length) return res.status(200).json({ success: true, date, data: [] });
      scheduleFilter.residentId = { $in: scope };
    }

    const schedules = await MedicationSchedule.find(scheduleFilter)
      .populate({
        path: 'residentId',
        select: 'fullName roomId',
        populate: { path: 'roomId', select: 'roomNumber' },
      })
      .populate('markedBy', 'fullName role')
      .sort({ scheduledTime: 1 });

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

    return res.status(200).json({ success: true, date, data: [...grouped.values()] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/medications/schedule ────────────────────────────────────────────

const getSchedules = async (req, res) => {
  try {
    const { residentId, date, status } = req.query;

    if (!residentId) {
      return res.status(400).json({ success: false, message: 'residentId là tham số bắt buộc trong query' });
    }
    if (!isValidObjectId(residentId)) {
      return res.status(400).json({ success: false, message: 'residentId phải là ObjectId hợp lệ' });
    }
    if (date && !isValidDateStr(date)) {
      return res.status(400).json({ success: false, message: 'date phải đúng định dạng YYYY-MM-DD' });
    }

    // Scope check
    const scope = await getResidentScope(req.user._id, req.user.role);
    if (!isInScope(residentId, scope)) {
      return res.status(403).json({ success: false, message: 'Cư dân không được phân công cho bạn' });
    }

    const filter = { residentId };
    if (status && status.toUpperCase() !== 'ALL') filter.status = status;
    if (date) {
      const { start, end } = getDayBounds(date);
      filter.scheduledTime = { $gte: start, $lte: end };
    }

    const schedules = await MedicationSchedule.find(filter)
      .populate('markedBy', 'fullName role')
      .sort({ scheduledTime: 1 });

    return res.status(200).json({ success: true, data: schedules });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/medications/schedule/:id/taken ─────────────────────────────────

const markTaken = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'ID lịch không hợp lệ' });
    }

    const { actualTimeTaken, notes } = req.body;

    const schedule = await MedicationSchedule.findById(req.params.id);
    if (!schedule) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy lịch' });
    }

    // Scope check — nurse can only mark for assigned residents
    const scope = await getResidentScope(req.user._id, req.user.role);
    if (!isInScope(schedule.residentId, scope)) {
      return res.status(403).json({ success: false, message: 'Cư dân không được phân công cho bạn' });
    }

    if (!['PENDING', 'OVERDUE'].includes(schedule.status)) {
      return res.status(400).json({
        success: false,
        message: `Không thể đánh dấu đã dùng: trạng thái hiện tại là ${schedule.status}`,
      });
    }

    // Look up the prescription item to get medicationId for inventory deduction
    const prescription = await Prescription.findById(schedule.prescriptionId);
    const prescriptionItem = prescription?.items?.id(schedule.prescriptionItemId);
    const medicationId = prescriptionItem?.medicationId;

    const takenAt = actualTimeTaken ? new Date(actualTimeTaken) : new Date();
    if (isNaN(takenAt.getTime())) {
      return res.status(400).json({ success: false, message: 'actualTimeTaken phải là ngày ISO hợp lệ' });
    }

    const diffMs = takenAt.getTime() - schedule.scheduledTime.getTime();
    const late = diffMs > ONE_HOUR_MS;
    schedule.administrationTiming = diffMs < 0 ? 'early' : late ? 'late' : 'on_time';
    schedule.status = late ? 'LATE_TAKEN' : 'TAKEN';
    schedule.markedBy = req.user._id;
    schedule.markedAt = new Date();
    schedule.actualTimeTaken = takenAt;
    if (notes !== undefined) schedule.notes = notes;

    await schedule.save();

    const takenEventLabel =
      schedule.administrationTiming === 'early' ? 'dùng thuốc sớm'
        : schedule.administrationTiming === 'late' ? 'dùng thuốc muộn'
        : 'dùng thuốc';
    await notifyDoctorOfSchedule(schedule, prescription, takenEventLabel);

    // Auto-create MedicationDispense to deduct inventory — compute quantity from prescription item dosage
    if (medicationId) {
      try {
        // derive numeric quantity from prescription item dosage string (e.g. "20", "20 mg", "2 tablets")
        let qty = 1;
        const rawDosage = prescriptionItem?.dosage || schedule.dosage || '';
        if (rawDosage) {
          const m = String(rawDosage).trim().match(/^\s*([0-9]+(?:\.[0-9]+)?)/);
          if (m) {
            qty = Number(m[1]) || 1;
          }
        }

        await MedicationDispense.create({
          medicationId,
          prescriptionId: schedule.prescriptionId,
          residentId: schedule.residentId,
          quantity: qty,
          dispensedByUserId: req.user._id,
          dispensedAt: takenAt,
          notes: `Auto-dispensed: ${schedule.medicationName} (schedule ${schedule._id})`,
        });
      } catch (dispenseErr) {
        console.error('Auto-dispense failed (non-blocking):', dispenseErr.message);
      }
    }

    await maybeCompletePrescriptionItem(prescription, schedule.prescriptionItemId, req.user._id);

    await schedule.populate('markedBy', 'fullName role');

    return res.status(200).json({ success: true, data: schedule });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/medications/schedule/:id/missed ────────────────────────────────

const markMissed = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'ID lịch không hợp lệ' });
    }

    const { reason, notes } = req.body;

    if (!reason || !MISSED_REASONS.includes(reason)) {
      return res.status(400).json({
        success: false,
        message: `reason là bắt buộc và phải thuộc một trong: ${MISSED_REASONS.join(', ')}`,
      });
    }

    const schedule = await MedicationSchedule.findById(req.params.id);
    if (!schedule) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy lịch' });
    }

    // Scope check
    const scope = await getResidentScope(req.user._id, req.user.role);
    if (!isInScope(schedule.residentId, scope)) {
      return res.status(403).json({ success: false, message: 'Cư dân không được phân công cho bạn' });
    }

    if (!['PENDING', 'OVERDUE'].includes(schedule.status)) {
      return res.status(400).json({
        success: false,
        message: `Không thể đánh dấu bỏ lỡ: trạng thái hiện tại là ${schedule.status}`,
      });
    }

    schedule.status = 'MISSED';
    schedule.markedBy = req.user._id;
    schedule.markedAt = new Date();
    schedule.missedReason = reason;
    if (notes !== undefined) schedule.notes = notes;

    await schedule.save();

    const prescription = await Prescription.findById(schedule.prescriptionId);
    await notifyDoctorOfSchedule(schedule, prescription, 'bỏ lỡ liều');
    await maybeCompletePrescriptionItem(prescription, schedule.prescriptionItemId, req.user._id);

    await schedule.populate('markedBy', 'fullName role');

    return res.status(200).json({ success: true, data: schedule });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/medications/history ──────────────────────────────────────────────

const getHistory = async (req, res) => {
  try {
    const { residentId, from, to, medicationName, prescriptionId } = req.query;

    if (!residentId) {
      return res.status(400).json({ success: false, message: 'residentId là tham số bắt buộc trong query' });
    }
    if (!isValidObjectId(residentId)) {
      return res.status(400).json({ success: false, message: 'residentId phải là ObjectId hợp lệ' });
    }
    if (prescriptionId && !isValidObjectId(prescriptionId)) {
      return res.status(400).json({ success: false, message: 'prescriptionId phải là ObjectId hợp lệ' });
    }
    if (from && !isValidDateStr(from)) {
      return res.status(400).json({ success: false, message: 'from phải đúng định dạng YYYY-MM-DD' });
    }
    if (to && !isValidDateStr(to)) {
      return res.status(400).json({ success: false, message: 'to phải đúng định dạng YYYY-MM-DD' });
    }

    // Scope check
    const scope = await getResidentScope(req.user._id, req.user.role);
    if (!isInScope(residentId, scope)) {
      return res.status(403).json({ success: false, message: 'Cư dân không được phân công cho bạn' });
    }

    const resident = await Resident.findById(residentId).select('fullName');
    if (!resident) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy cư dân' });
    }

    const filter = { residentId };
    if (prescriptionId) filter.prescriptionId = prescriptionId;
    if (from || to) {
      filter.scheduledTime = {};
      if (from) filter.scheduledTime.$gte = new Date(`${from}T00:00:00+07:00`);
      if (to) filter.scheduledTime.$lte = new Date(`${to}T23:59:59.999+07:00`);
    }
    if (medicationName) filter.medicationName = { $regex: medicationName, $options: 'i' };

    const records = await MedicationSchedule.find(filter)
      .populate('markedBy', 'fullName role')
      .sort({ scheduledTime: 1 });

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

    return res.status(200).json({
      success: true,
      data: {
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
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getAvailableMedications,
  getCurrentMedications,
  setMedicationSchedule,
  getDailySchedule,
  getSchedules,
  markTaken,
  markMissed,
  getHistory,
};

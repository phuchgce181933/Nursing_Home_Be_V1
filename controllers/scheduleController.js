const { isValidObjectId } = require('mongoose');
const MedicationSchedule = require('../models/MedicationSchedule');
const Prescription = require('../models/prescription');
const Resident = require('../models/resident');
const Room = require('../models/room');
const { generateSchedulesForItem } = require('../services/scheduleGeneratorService');

const MISSED_REASONS = ['refused', 'asleep', 'vomiting', 'hospitalized', 'other'];
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// Validate YYYY-MM-DD format and parsability
const isValidDateStr = (str) =>
  typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str).getTime());

// Vietnam-local day boundaries as UTC Dates
const getDayBounds = (dateStr) => ({
  start: new Date(`${dateStr}T00:00:00+07:00`),
  end: new Date(`${dateStr}T23:59:59.999+07:00`),
});

const getTodayVN = () => {
  const vnMs = Date.now() + 7 * 60 * 60 * 1000;
  return new Date(vnMs).toISOString().slice(0, 10);
};

// ISO week key in Vietnam local date: "YYYY-Www"
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

// ── GET /api/medications/current — View Medication List ───────────────────────
// Returns flat list of all active medication items from ACTIVE prescriptions.
const getCurrentMedications = async (req, res) => {
  try {
    const { residentId } = req.query;

    if (!residentId) {
      return res.status(400).json({ success: false, message: 'residentId query parameter is required' });
    }
    if (!isValidObjectId(residentId)) {
      return res.status(400).json({ success: false, message: 'residentId must be a valid ObjectId' });
    }

    const resident = await Resident.findById(residentId).select('fullName');
    if (!resident) {
      return res.status(404).json({ success: false, message: 'Resident not found' });
    }

    const prescriptions = await Prescription.find({ residentId, status: 'ACTIVE' })
      .populate('doctorId', 'fullName')
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

// ── PUT /api/medications/schedule/set — Set Medication Schedule (Doctor) ─────
// Doctor sets startDate, endDate, times for one or more prescription items.
// Regenerates future PENDING schedules for each updated item.
const setMedicationSchedule = async (req, res) => {
  try {
    const { prescriptionId, items } = req.body;

    if (!prescriptionId || !isValidObjectId(prescriptionId)) {
      return res.status(400).json({ success: false, message: 'prescriptionId must be a valid ObjectId' });
    }
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: 'items must be a non-empty array' });
    }

    const prescription = await Prescription.findById(prescriptionId);
    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }
    if (prescription.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, message: 'Only ACTIVE prescriptions can be scheduled' });
    }

    // Validate all patches before modifying anything
    for (const patch of items) {
      if (!patch.prescriptionItemId || !isValidObjectId(patch.prescriptionItemId)) {
        return res.status(400).json({ success: false, message: 'Each item must have a valid prescriptionItemId' });
      }

      const existing = prescription.items.id(patch.prescriptionItemId);
      if (!existing) {
        return res.status(400).json({
          success: false,
          message: `prescriptionItemId ${patch.prescriptionItemId} not found in this prescription`,
        });
      }

      if (patch.times !== undefined) {
        if (!Array.isArray(patch.times) || patch.times.length !== existing.frequency) {
          return res.status(400).json({
            success: false,
            message: `times for ${existing.medicationName} must have exactly ${existing.frequency} entries (matching frequency)`,
          });
        }
        const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
        if (!patch.times.every((t) => timeRegex.test(t))) {
          return res.status(400).json({
            success: false,
            message: `times entries must be in HH:MM format (e.g. "08:00")`,
          });
        }
      }

      if (patch.startDate && !isValidDateStr(patch.startDate)) {
        return res.status(400).json({ success: false, message: `startDate must be YYYY-MM-DD` });
      }
      if (patch.endDate && !isValidDateStr(patch.endDate)) {
        return res.status(400).json({ success: false, message: `endDate must be YYYY-MM-DD` });
      }

      const effectiveStart = patch.startDate ? new Date(patch.startDate) : existing.startDate;
      const effectiveEnd = patch.endDate ? new Date(patch.endDate) : existing.endDate;

      if (effectiveStart && effectiveEnd && effectiveEnd <= effectiveStart) {
        return res.status(400).json({
          success: false,
          message: `endDate must be after startDate for ${existing.medicationName}`,
        });
      }
      if (effectiveEnd && effectiveEnd > prescription.validUntil) {
        return res.status(400).json({
          success: false,
          message: `endDate for ${existing.medicationName} cannot be after prescription validUntil (${prescription.validUntil.toISOString().slice(0, 10)})`,
        });
      }
    }

    // Apply changes and collect items to reschedule
    const changeLog = [];
    const rescheduledItems = [];

    for (const patch of items) {
      const item = prescription.items.id(patch.prescriptionItemId);
      const changes = [];

      if (patch.startDate !== undefined) {
        item.startDate = new Date(patch.startDate);
        changes.push(`startDate=${patch.startDate}`);
      }
      if (patch.endDate !== undefined) {
        item.endDate = new Date(patch.endDate);
        changes.push(`endDate=${patch.endDate}`);
      }
      if (patch.times !== undefined) {
        item.times = patch.times;
        changes.push(`times=[${patch.times.join(',')}]`);
      }

      if (changes.length) {
        changeLog.push(`Set schedule for ${item.medicationName}: ${changes.join(', ')}`);
        rescheduledItems.push(item);
      }
    }

    if (!changeLog.length) {
      return res.status(200).json({ success: true, message: 'No schedule changes detected', data: prescription });
    }

    prescription.editHistory.push({
      editedBy: req.user._id,
      editedAt: new Date(),
      changes: changeLog.join('; '),
    });

    await prescription.save();

    // Regenerate AFTER save so item._ids are stable
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
      schedulesCreated += after - before + before; // count newly created
    }

    const populated = await Prescription.findById(prescription._id)
      .populate('residentId', 'fullName dateOfBirth')
      .populate('doctorId', 'fullName')
      .populate('editHistory.editedBy', 'fullName role');

    return res.status(200).json({
      success: true,
      message: `Schedule updated for ${rescheduledItems.length} medication(s)`,
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
      return res.status(400).json({ success: false, message: 'date must be YYYY-MM-DD' });
    }

    const { start, end } = getDayBounds(date);
    const scheduleFilter = { scheduledTime: { $gte: start, $lte: end } };
    if (status) scheduleFilter.status = status;

    if (residentId) {
      if (!isValidObjectId(residentId)) {
        return res.status(400).json({ success: false, message: 'residentId must be a valid ObjectId' });
      }
      scheduleFilter.residentId = residentId;
    } else if (wardId) {
      if (!isValidObjectId(wardId)) {
        return res.status(400).json({ success: false, message: 'wardId must be a valid ObjectId' });
      }
      const rooms = await Room.find({ floorId: wardId }).select('_id');
      const roomIds = rooms.map((r) => r._id);
      const residents = await Resident.find({ roomId: { $in: roomIds } }).select('_id');
      if (!residents.length) {
        return res.status(200).json({ success: true, date, data: [] });
      }
      scheduleFilter.residentId = { $in: residents.map((r) => r._id) };
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
      return res.status(400).json({ success: false, message: 'residentId query parameter is required' });
    }
    if (!isValidObjectId(residentId)) {
      return res.status(400).json({ success: false, message: 'residentId must be a valid ObjectId' });
    }
    if (date && !isValidDateStr(date)) {
      return res.status(400).json({ success: false, message: 'date must be YYYY-MM-DD' });
    }

    const filter = { residentId };
    if (status) filter.status = status;
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
      return res.status(400).json({ success: false, message: 'Invalid schedule id' });
    }

    const { actualTimeTaken, notes } = req.body;

    const schedule = await MedicationSchedule.findById(req.params.id);
    if (!schedule) {
      return res.status(404).json({ success: false, message: 'Schedule not found' });
    }
    if (!['PENDING', 'OVERDUE'].includes(schedule.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot mark as taken: current status is ${schedule.status}`,
      });
    }

    const takenAt = actualTimeTaken ? new Date(actualTimeTaken) : new Date();
    if (isNaN(takenAt.getTime())) {
      return res.status(400).json({ success: false, message: 'actualTimeTaken must be a valid ISO date' });
    }

    const late = takenAt.getTime() - schedule.scheduledTime.getTime() > TWO_HOURS_MS;
    schedule.status = late ? 'LATE_TAKEN' : 'TAKEN';
    schedule.markedBy = req.user._id;
    schedule.markedAt = new Date();
    schedule.actualTimeTaken = takenAt;
    if (notes !== undefined) schedule.notes = notes;

    await schedule.save();
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
      return res.status(400).json({ success: false, message: 'Invalid schedule id' });
    }

    const { reason, notes } = req.body;

    if (!reason || !MISSED_REASONS.includes(reason)) {
      return res.status(400).json({
        success: false,
        message: `reason is required and must be one of: ${MISSED_REASONS.join(', ')}`,
      });
    }

    const schedule = await MedicationSchedule.findById(req.params.id);
    if (!schedule) {
      return res.status(404).json({ success: false, message: 'Schedule not found' });
    }
    if (!['PENDING', 'OVERDUE'].includes(schedule.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot mark as missed: current status is ${schedule.status}`,
      });
    }

    schedule.status = 'MISSED';
    schedule.markedBy = req.user._id;
    schedule.markedAt = new Date();
    schedule.missedReason = reason;
    if (notes !== undefined) schedule.notes = notes;

    await schedule.save();
    await schedule.populate('markedBy', 'fullName role');

    return res.status(200).json({ success: true, data: schedule });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/medications/history ──────────────────────────────────────────────

const getHistory = async (req, res) => {
  try {
    const { residentId, from, to, medicationName } = req.query;

    if (!residentId) {
      return res.status(400).json({ success: false, message: 'residentId query parameter is required' });
    }
    if (!isValidObjectId(residentId)) {
      return res.status(400).json({ success: false, message: 'residentId must be a valid ObjectId' });
    }
    if (from && !isValidDateStr(from)) {
      return res.status(400).json({ success: false, message: 'from must be YYYY-MM-DD' });
    }
    if (to && !isValidDateStr(to)) {
      return res.status(400).json({ success: false, message: 'to must be YYYY-MM-DD' });
    }

    const resident = await Resident.findById(residentId).select('fullName');
    if (!resident) {
      return res.status(404).json({ success: false, message: 'Resident not found' });
    }

    const filter = { residentId };
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
    const total = records.length;
    const denominator = taken + lateTaken + missed;
    const complianceRate =
      denominator > 0 ? Math.round(((taken + lateTaken) / denominator) * 1000) / 10 : null;

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
        summary: { total, taken, lateTaken, missed, skipped, complianceRate },
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
  getCurrentMedications,
  setMedicationSchedule,
  getDailySchedule,
  getSchedules,
  markTaken,
  markMissed,
  getHistory,
};

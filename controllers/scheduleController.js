const MedicationSchedule = require('../models/MedicationSchedule');
const Resident = require('../models/resident');
const Room = require('../models/room');

const MISSED_REASONS = ['refused', 'asleep', 'vomiting', 'hospitalized', 'other'];
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// Compute Vietnam-local day boundaries as UTC dates
const getDayBounds = (dateStr) => {
  const start = new Date(`${dateStr}T00:00:00+07:00`);
  const end = new Date(`${dateStr}T23:59:59.999+07:00`);
  return { start, end };
};

const getTodayVN = () => {
  const now = new Date();
  // Shift to UTC+7 then extract YYYY-MM-DD
  const vnMs = now.getTime() + 7 * 60 * 60 * 1000;
  return new Date(vnMs).toISOString().slice(0, 10);
};

// ISO week key: "YYYY-Www"
const isoWeekKey = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
};

// ── GET /api/medications/schedule/daily ──────────────────────────────────────

const getDailySchedule = async (req, res) => {
  try {
    const { date = getTodayVN(), residentId, wardId, status } = req.query;
    const { start, end } = getDayBounds(date);

    const scheduleFilter = { scheduledTime: { $gte: start, $lte: end } };
    if (status) scheduleFilter.status = status;

    if (residentId) {
      scheduleFilter.residentId = residentId;
    } else if (wardId) {
      // wardId = floorId; find rooms on that floor, then residents in those rooms
      const rooms = await Room.find({ floorId: wardId }).select('_id');
      const roomIds = rooms.map((r) => r._id);
      const residents = await Resident.find({ roomId: { $in: roomIds } }).select('_id');
      if (!residents.length) {
        return res.status(200).json({ success: true, data: [] });
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

    // Group by resident
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
        medicationName: s.medicationName,
        dosage: s.dosage,
        route: s.route,
        scheduledTime: s.scheduledTime,
        status: s.status,
        markedBy: s.markedBy || null,
        notes: s.notes || null,
      });
    }

    return res.status(200).json({
      success: true,
      date,
      data: [...grouped.values()],
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/medications/schedule ────────────────────────────────────────────

const getSchedules = async (req, res) => {
  try {
    const { residentId, date, status } = req.query;

    if (!residentId) {
      return res.status(400).json({
        success: false,
        message: 'residentId query parameter is required',
      });
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
      return res.status(400).json({
        success: false,
        message: 'residentId query parameter is required',
      });
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
    if (medicationName) {
      filter.medicationName = { $regex: medicationName, $options: 'i' };
    }

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

    // Weekly compliance grouped by ISO week key
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
          date: r.scheduledTime.toISOString().slice(0, 10),
          medicationName: r.medicationName,
          dosage: r.dosage,
          route: r.route,
          scheduledTime: r.scheduledTime,
          status: r.status,
          markedBy: r.markedBy || null,
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

module.exports = { getDailySchedule, getSchedules, markTaken, markMissed, getHistory };

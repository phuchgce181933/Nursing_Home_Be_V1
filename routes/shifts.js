const express = require('express');
const router = express.Router();
const Shift = require('../models/shift');
const ShiftTemplate = require('../models/shiftTemplate');
const StaffProfile = require('../models/staffProfile');
const Resident = require('../models/resident');
const User = require('../models/user');
const LeaveRequest = require('../models/leaveRequest');
const { protect, authorize } = require('../middleware/auth');

const normalizeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.toISOString().slice(0, 10));
};

const parseTime = (time) => {
  if (!time || typeof time !== 'string') return null;
  const [hour, minute] = time.split(':').map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
};

const buildConflicts = async ({ assignedStaffId, workDate, startTime, endTime, excludeId }) => {
  const conflicts = [];
  const parsedDate = normalizeDate(workDate);
  const staffProfile = assignedStaffId
    ? await StaffProfile.findOne({ $or: [{ _id: assignedStaffId }, { userId: assignedStaffId }] }).populate('userId').lean()
    : null;

  if (!parsedDate) {
    conflicts.push({ type: 'INVALID_TIME', severity: 'ERROR', message: 'workDate is invalid' });
  }
  const startMinutes = parseTime(startTime);
  const endMinutes = parseTime(endTime);
  if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
    conflicts.push({ type: 'INVALID_TIME', severity: 'ERROR', message: 'Invalid start/end time' });
  }

  if (parsedDate) {
    const today = normalizeDate(new Date().toISOString().slice(0, 10));
    if (parsedDate < today) {
      conflicts.push({ type: 'PAST_DATE', severity: 'ERROR', message: 'Date is in the past' });
    }
  }

  if (staffProfile && staffProfile.userId) {
    const user = staffProfile.userId;
    if (!['doctor', 'nurse'].includes(user.role)) {
      conflicts.push({ type: 'ROLE_MISMATCH', severity: 'ERROR', message: 'Staff role cannot be scheduled for patient care' });
    }
    if (parsedDate) {
      const leave = await LeaveRequest.findOne({
        userId: user._id,
        status: 'approved',
        startDate: { $lte: parsedDate },
        endDate: { $gte: parsedDate },
      }).lean();
      if (leave) {
        conflicts.push({ type: 'LEAVE_CONFLICT', severity: 'ERROR', message: 'Staff is on approved leave for this date' });
      }

      if (startMinutes !== null && endMinutes !== null) {
        const overlapQuery = {
          assignedStaffId: staffProfile._id,
          workDate: parsedDate,
          status: { $ne: 'cancelled' },
        };
        if (excludeId) overlapQuery._id = { $ne: excludeId };

        const existingShifts = await Shift.find(overlapQuery).lean();
        const hasOverlap = existingShifts.some((existing) => {
          const existingStart = parseTime(existing.startTime);
          const existingEnd = parseTime(existing.endTime);
          return existingStart !== null && existingEnd !== null && startMinutes < existingEnd && endMinutes > existingStart;
        });
        if (hasOverlap) {
          conflicts.push({ type: 'OVERLAP', severity: 'ERROR', message: 'Staff has another shift during this time' });
        }
      }
    }
  }

  return conflicts;
};

const resolveStaffProfile = async (value) => {
  if (!value) return null;
  const byId = await StaffProfile.findById(value).lean();
  if (byId) return byId;
  return StaffProfile.findOne({ userId: value }).lean();
};

const includeShiftPopulations = (query) =>
  query
    .populate({ path: 'assignedStaffId', populate: { path: 'userId', model: 'User' } })
    .populate('shiftTemplateId');

router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.fromDate || req.query.toDate) {
      filter.workDate = {};
      if (req.query.fromDate) {
        const parsed = normalizeDate(req.query.fromDate);
        if (parsed) filter.workDate.$gte = parsed;
      }
      if (req.query.toDate) {
        const parsed = normalizeDate(req.query.toDate);
        if (parsed) filter.workDate.$lte = parsed;
      }
      if (Object.keys(filter.workDate).length === 0) delete filter.workDate;
    }
    if (req.query.assignedStaffId) {
      const profile = await resolveStaffProfile(req.query.assignedStaffId);
      if (profile) filter.assignedStaffId = profile._id;
    }

    const limit = Number(req.query.limit) || 200;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const query = Shift.find(filter).sort({ workDate: -1, startTime: 1 });
    includeShiftPopulations(query);
    const [shifts, total] = await Promise.all([query.skip((page - 1) * limit).limit(limit).lean(), Shift.countDocuments(filter)]);
    res.json({ data: shifts, total, page });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.get('/schedule', protect, authorize('admin'), async (req, res) => {
  try {
    const filter = {};
    if (req.query.fromDate || req.query.toDate) {
      filter.workDate = {};
      if (req.query.fromDate) {
        const parsed = normalizeDate(req.query.fromDate);
        if (parsed) filter.workDate.$gte = parsed;
      }
      if (req.query.toDate) {
        const parsed = normalizeDate(req.query.toDate);
        if (parsed) filter.workDate.$lte = parsed;
      }
      if (Object.keys(filter.workDate).length === 0) delete filter.workDate;
    }
    const shifts = await Shift.find(filter).sort({ workDate: 1, startTime: 1 }).populate({ path: 'assignedStaffId', populate: { path: 'userId', model: 'User' } }).populate('shiftTemplateId').lean();
    res.json({ data: shifts });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.get('/check-conflicts', protect, authorize('admin'), async (req, res) => {
  try {
    const conflicts = await buildConflicts({
      assignedStaffId: req.query.assignedStaffId,
      workDate: req.query.workDate,
      startTime: req.query.startTime,
      endTime: req.query.endTime,
      excludeId: req.query.excludeId,
    });
    res.json({ data: { conflicts, hasErrors: conflicts.some((c) => c.severity === 'ERROR') } });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.post('/', protect, authorize('admin'), async (req, res) => {
  try {
    const { name, startTime, endTime, workDate, assignedStaffId, shiftTemplateId, floorId, roomId, taskDescription, notes } = req.body || {};
    if (!name || !startTime || !endTime || !workDate || !assignedStaffId || !floorId) {
      return res.status(400).json({ message: 'Missing required shift fields' });
    }

    const profile = await resolveStaffProfile(assignedStaffId);
    if (!profile) return res.status(400).json({ message: 'Assigned staff profile not found' });

    const shift = await Shift.create({
      name,
      startTime,
      endTime,
      workDate: normalizeDate(workDate),
      assignedStaffId: profile._id,
      shiftTemplateId: shiftTemplateId || undefined,
      floorId,
      roomId,
      notes: notes || taskDescription || '',
      status: 'draft',
    });

    const created = await Shift.findById(shift._id).populate({ path: 'assignedStaffId', populate: { path: 'userId', model: 'User' } }).populate('shiftTemplateId').lean();
    res.status(201).json({ data: created });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.put('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) return res.status(404).json({ message: 'Shift not found' });
    if (['completed', 'cancelled'].includes(shift.status)) {
      return res.status(400).json({ message: 'Cannot edit completed or cancelled shift' });
    }

    const { name, startTime, endTime, workDate, assignedStaffId, shiftTemplateId, floorId, roomId, taskDescription, notes, changeReason } = req.body || {};
    if (!changeReason && shift.status !== 'draft') {
      return res.status(400).json({ message: 'changeReason is required to update this shift' });
    }

    if (assignedStaffId) {
      const profile = await resolveStaffProfile(assignedStaffId);
      if (!profile) return res.status(400).json({ message: 'Assigned staff profile not found' });
      shift.assignedStaffId = profile._id;
    }
    if (name !== undefined) shift.name = name;
    if (startTime !== undefined) shift.startTime = startTime;
    if (endTime !== undefined) shift.endTime = endTime;
    if (workDate !== undefined) shift.workDate = normalizeDate(workDate);
    if (shiftTemplateId !== undefined) shift.shiftTemplateId = shiftTemplateId || undefined;
    if (floorId !== undefined) shift.floorId = floorId;
    if (roomId !== undefined) shift.roomId = roomId;
    if (taskDescription !== undefined) shift.notes = taskDescription;
    if (notes !== undefined) shift.notes = notes;
    await shift.save();

    const updated = await Shift.findById(shift._id).populate({ path: 'assignedStaffId', populate: { path: 'userId', model: 'User' } }).populate('shiftTemplateId').lean();
    res.json({ data: updated, conflicts: [] });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.put('/:id/publish', protect, authorize('admin'), async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) return res.status(404).json({ message: 'Shift not found' });
    if (shift.status !== 'draft') return res.status(400).json({ message: 'Only draft shifts can be published' });

    const conflicts = await buildConflicts({
      assignedStaffId: shift.assignedStaffId,
      workDate: shift.workDate,
      startTime: shift.startTime,
      endTime: shift.endTime,
      excludeId: shift._id,
    });
    if (conflicts.some((c) => c.severity === 'ERROR')) {
      return res.status(400).json({ message: 'Conflicts must be resolved before publishing', conflicts });
    }

    shift.status = 'published';
    await shift.save();
    const published = await Shift.findById(shift._id).populate({ path: 'assignedStaffId', populate: { path: 'userId', model: 'User' } }).populate('shiftTemplateId').lean();
    res.json({ data: published, conflicts });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.put('/:id/confirm', protect, authorize('admin'), async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) return res.status(404).json({ message: 'Shift not found' });
    if (shift.status !== 'published') return res.status(400).json({ message: 'Only published shifts can be confirmed' });
    shift.status = 'confirmed';
    await shift.save();
    const confirmed = await Shift.findById(shift._id).populate({ path: 'assignedStaffId', populate: { path: 'userId', model: 'User' } }).populate('shiftTemplateId').lean();
    res.json({ data: confirmed });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.put('/:id/cancel', protect, authorize('admin'), async (req, res) => {
  try {
    const { reason } = req.body || {};
    const shift = await Shift.findById(req.params.id);
    if (!shift) return res.status(404).json({ message: 'Shift not found' });
    if (shift.status === 'cancelled') return res.status(400).json({ message: 'Shift is already cancelled' });
    shift.status = 'cancelled';
    if (reason) shift.notes = `${reason}${shift.notes ? ' · ' + shift.notes : ''}`;
    await shift.save();
    const cancelled = await Shift.findById(shift._id).populate({ path: 'assignedStaffId', populate: { path: 'userId', model: 'User' } }).populate('shiftTemplateId').lean();
    res.json({ data: cancelled });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) return res.status(404).json({ message: 'Shift not found' });
    if (shift.status !== 'draft') return res.status(400).json({ message: 'Only draft shifts can be deleted' });
    await shift.deleteOne();
    res.json({ data: shift });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

module.exports = router;

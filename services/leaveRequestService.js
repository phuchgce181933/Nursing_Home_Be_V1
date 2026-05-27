const ServiceError = require('./serviceError');
const leaveRequestRepo = require('../repositories/leaveRequestRepository');
const shiftRepo = require('../repositories/shiftRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const { LEAVE_REQUEST_TYPES, LEAVE_REQUEST_STATUSES } = require('../models/enums');
const {
  triggerReadinessSyncForRange,
  triggerReadinessSyncForWorkDate,
} = require('./readinessSyncService');

// ── helpers ──────────────────────────────────────────────────────────────────

const calcDays = (start, end) => {
  const startDay = new Date(start.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const endDay = new Date(end.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const ms = endDay.getTime() - startDay.getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)) + 1);
};

// ── STT 11 – submit leave request ────────────────────────────────────────────

const submitLeaveRequest = async (currentUser, { type, startDate, endDate, reason }) => {
  if (!type || !startDate || !endDate || !reason) {
    throw new ServiceError('type, startDate, endDate and reason are required', 400);
  }
  if (!LEAVE_REQUEST_TYPES.includes(type)) {
    throw new ServiceError(`type must be one of: ${LEAVE_REQUEST_TYPES.join(', ')}`, 400);
  }

  const toUTCDate = (d, end = false) => {
    const s = typeof d === 'string' && d.length === 10 ? d : new Date(d).toISOString().slice(0, 10);
    return new Date(s + (end ? 'T23:59:59.999Z' : 'T00:00:00.000Z'));
  };
  const start = toUTCDate(startDate);
  const end = toUTCDate(endDate, true);

  if (end < start) throw new ServiceError('endDate must be after or equal to startDate', 400);

  // 24h advance notice (not required for emergency)
  if (type !== 'emergency') {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (start < cutoff) {
      throw new ServiceError('Leave requests must be submitted at least 24 hours in advance (except emergency)', 400);
    }
  }

  // Block if overlapping approved leave already exists
  const existing = await leaveRequestRepo.findApprovedOverlapping(currentUser._id, start, end);
  if (existing.length) {
    throw new ServiceError('You already have an approved leave request overlapping these dates', 409);
  }

  const daysRequested = calcDays(start, end);

  // Check leave balance warning
  let balanceWarning = null;
  const profile = await staffProfileRepo.findByUserId(currentUser._id);
  if (profile && profile.leaveBalance && type !== 'unpaid') {
    const balance = profile.leaveBalance[type] ?? 0;
    if (daysRequested > balance) {
      balanceWarning = `Requested ${daysRequested} day(s) but only ${balance} day(s) remain for type '${type}'`;
    }
  }

  // Warn about confirmed shifts in range
  let shiftWarning = null;
  if (profile) {
    const confirmedShifts = await shiftRepo.findByStaffAndDateRange(profile._id, start, end);
    const confirmed = confirmedShifts.filter((s) => s.status === 'confirmed');
    if (confirmed.length) {
      shiftWarning = `You have ${confirmed.length} confirmed shift(s) during the requested leave period`;
    }
  }

  const request = await leaveRequestRepo.create({
    staffId: currentUser._id,
    type,
    startDate: start,
    endDate: end,
    reason: reason.trim(),
    daysRequested,
    status: 'pending',
  });

  return {
    message: 'Leave request submitted',
    request,
    ...(balanceWarning && { balanceWarning }),
    ...(shiftWarning && { shiftWarning }),
  };
};

// ── list leave requests ───────────────────────────────────────────────────────

const listLeaveRequests = async (currentUser, { staffId, status, fromDate, toDate, page = 1, limit = 20 }) => {
  const filter = {};

  if (!['admin', 'manager'].includes(currentUser.role)) {
    filter.staffId = currentUser._id;
  } else if (staffId) {
    filter.staffId = staffId;
  }

  if (status) {
    if (!LEAVE_REQUEST_STATUSES.includes(status)) {
      throw new ServiceError(`status must be one of: ${LEAVE_REQUEST_STATUSES.join(', ')}`, 400);
    }
    filter.status = status;
  }
  if (fromDate || toDate) {
    filter.startDate = {};
    if (fromDate) filter.startDate.$gte = new Date(fromDate);
    if (toDate) filter.startDate.$lte = new Date(toDate);
  }

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * limitNum;

  const [data, total] = await Promise.all([
    leaveRequestRepo.findAll(filter, { skip, limit: limitNum }),
    leaveRequestRepo.countAll(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

const getLeaveRequest = async (currentUser, id) => {
  const request = await leaveRequestRepo.findById(id);
  if (!request) throw new ServiceError('Leave request not found', 404);

  if (!['admin', 'manager'].includes(currentUser.role)) {
    if (request.staffId._id.toString() !== currentUser._id.toString()) {
      throw new ServiceError('Access forbidden', 403);
    }
  }
  return request;
};

// ── STT 12 – approve leave request ───────────────────────────────────────────

const approveLeaveRequest = async (currentUser, id, { reviewNote } = {}) => {
  const request = await leaveRequestRepo.findById(id);
  if (!request) throw new ServiceError('Leave request not found', 404);
  if (request.status !== 'pending') throw new ServiceError('Only pending requests can be approved', 400);

  const updated = await leaveRequestRepo.updateById(id, {
    status: 'approved',
    reviewedBy: currentUser._id,
    reviewedAt: new Date(),
    reviewNote: reviewNote?.trim(),
  });

  // Deduct leave balance
  const staffUserId = request.staffId._id || request.staffId;
  const profile = await staffProfileRepo.findByUserId(staffUserId);
  if (profile && request.daysRequested && request.type !== 'unpaid') {
    const field = `leaveBalance.${request.type}`;
    const currentBalance = profile.leaveBalance?.[request.type] ?? 0;
    const newBalance = Math.max(0, currentBalance - request.daysRequested);
    await staffProfileRepo.updateById(profile._id, { [field]: newBalance });
  }

  // Auto-cancel shifts in leave period
  let cancelledShifts = [];
  if (profile) {
    const shiftsInRange = await shiftRepo.findByStaffAndDateRange(
      profile._id,
      request.startDate,
      request.endDate
    );
    const toCancel = shiftsInRange.filter((s) => !['completed', 'cancelled'].includes(s.status));
    for (const shift of toCancel) {
      await shiftRepo.updateById(shift._id, {
        status: 'cancelled',
        $push: {
          changeLog: {
            changedBy: currentUser._id,
            fieldsChanged: ['status'],
            oldValues: { status: shift.status },
            newValues: { status: 'cancelled' },
            reason: `Auto-cancelled due to approved leave (LeaveRequest: ${id})`,
          },
        },
      });
      cancelledShifts.push({ shiftId: shift._id, workDate: shift.workDate, name: shift.name });
    }
  }

  triggerReadinessSyncForRange(request.startDate, request.endDate);
  for (const s of cancelledShifts) {
    triggerReadinessSyncForWorkDate(s.workDate);
  }

  return {
    message: 'Leave request approved',
    request: updated,
    ...(cancelledShifts.length && {
      cancelledShifts: { count: cancelledShifts.length, shifts: cancelledShifts },
    }),
  };
};

// ── STT 12 – reject leave request ────────────────────────────────────────────

const rejectLeaveRequest = async (currentUser, id, { reviewNote } = {}) => {
  const request = await leaveRequestRepo.findById(id);
  if (!request) throw new ServiceError('Leave request not found', 404);
  if (request.status !== 'pending') throw new ServiceError('Only pending requests can be rejected', 400);

  if (!reviewNote || !reviewNote.trim()) {
    throw new ServiceError('reviewNote (rejection reason) is required', 400);
  }

  const updated = await leaveRequestRepo.updateById(id, {
    status: 'rejected',
    reviewedBy: currentUser._id,
    reviewedAt: new Date(),
    reviewNote: reviewNote.trim(),
  });

  return { message: 'Leave request rejected', request: updated };
};

// ── cancel own leave request ──────────────────────────────────────────────────

const cancelLeaveRequest = async (currentUser, id) => {
  const request = await leaveRequestRepo.findById(id);
  if (!request) throw new ServiceError('Leave request not found', 404);
  if (request.staffId._id.toString() !== currentUser._id.toString()) {
    throw new ServiceError('You can only cancel your own requests', 403);
  }
  if (request.status !== 'pending') throw new ServiceError('Only pending requests can be cancelled', 400);

  await leaveRequestRepo.updateById(id, { status: 'cancelled' });
  return { message: 'Leave request cancelled' };
};

module.exports = {
  submitLeaveRequest,
  listLeaveRequests,
  getLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequest,
};

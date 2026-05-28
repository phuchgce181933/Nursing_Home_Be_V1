const shiftRepo = require('../repositories/shiftRepository');
const shiftTemplateRepo = require('../repositories/shiftTemplateRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const leaveRequestRepo = require('../repositories/leaveRequestRepository');
const LeaveRequest = require('../models/leaveRequest');
const StaffProfile = require('../models/staffProfile');
const { triggerReadinessSyncForWorkDate } = require('./readinessSyncService');
const {
  MAX_DAILY_HOURS,
  MAX_CONSECUTIVE_NIGHT_DAYS,
  ALLOWED_ROLES_BY_SHIFT_TYPE,
  calcShiftDurationHours,
  intervalsOverlap,
  isInvalidTimeRange,
  isNightShift,
  addUtcDays,
  hasExcessiveConsecutiveNightShifts,
  getStaffRole,
  isRoleAllowedForShiftType,
  isPastWorkDate,
  toMinutes,
} = require('../utils/shiftValidation');
const { isAssignableRole } = require('../utils/staffAssignment');

// ── Helpers ──────────────────────────────────────────────────────────────────

const parseWorkDateUtc = (workDate) =>
  new Date(
    typeof workDate === 'string' && workDate.length === 10
      ? workDate + 'T00:00:00.000Z'
      : new Date(workDate).toISOString().slice(0, 10) + 'T00:00:00.000Z'
  );

const getWeekBounds = (date) => {
  const d = new Date(date);
  const dayUTC = d.getUTCDay();
  const diffToMon = dayUTC === 0 ? -6 : 1 - dayUTC;
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMon, 0, 0, 0, 0));
  const sun = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + 6, 23, 59, 59, 999));
  return { weekStart: mon, weekEnd: sun };
};

/**
 * Resolves an assignedStaffId that may be either a StaffProfile._id or a User._id.
 * Returns the StaffProfile._id in either case.
 */
const resolveStaffProfileId = async (id) => {
  // First try direct StaffProfile lookup
  const byProfileId = await staffProfileRepo.findById(id);
  if (byProfileId) return byProfileId._id;
  // Fall back to lookup by userId (frontend passes User._id)
  const byUserId = await staffProfileRepo.findByUserId(id);
  if (byUserId) return byUserId._id;
  throw Object.assign(new Error('Staff profile not found for the provided assignedStaffId'), { status: 404 });
};

const assertNoApprovedLeaveOnDate = async (staffProfileId, workDate) => {
  const profile = await StaffProfile.findById(staffProfileId).select('userId');
  if (!profile?.userId) return;

  const day = new Date(workDate);
  const dayStart = new Date(day.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const dayEnd = new Date(day.toISOString().slice(0, 10) + 'T23:59:59.999Z');

  const overlapping = await leaveRequestRepo.findApprovedOverlapping(profile.userId, dayStart, dayEnd);
  if (overlapping.length) {
    throw Object.assign(new Error('Staff has an approved leave request on this date and cannot be assigned a shift.'), {
      status: 400,
    });
  }
};

// ── Conflict Detection ────────────────────────────────────────────────────────

/**
 * Validates shift assignment against 8 business rules (+ optional warnings).
 * Returns array of { type, severity, message, details? }.
 */
const checkConflicts = async ({ assignedStaffId, workDate, startTime, endTime, excludeId, shiftTemplateId }) => {
  const conflicts = [];
  const template = shiftTemplateId ? await shiftTemplateRepo.findById(shiftTemplateId) : null;
  const crossesMidnight = template?.crossesMidnight ?? false;

  // 8. PAST_DATE (ERROR)
  if (isPastWorkDate(workDate)) {
    conflicts.push({
      type: 'PAST_DATE',
      severity: 'ERROR',
      message: 'Cannot create or assign a shift on a past date.',
      details: { workDate },
    });
  }

  // 1. INVALID_TIME (ERROR) — end <= start without valid overnight pattern
  if (isInvalidTimeRange(startTime, endTime, { crossesMidnight })) {
    conflicts.push({
      type: 'INVALID_TIME',
      severity: 'ERROR',
      message: 'Invalid shift time: end time must be after start time (unless this is an overnight shift).',
      details: { startTime, endTime },
    });
    return conflicts;
  }

  const staffProfile = await StaffProfile.findById(assignedStaffId).populate('userId', 'role fullName');
  if (!staffProfile) {
    conflicts.push({
      type: 'ROLE_MISMATCH',
      severity: 'ERROR',
      message: 'Staff profile not found.',
      details: { assignedStaffId },
    });
    return conflicts;
  }

  const staffRole = getStaffRole(staffProfile);
  if (!isAssignableRole(staffRole)) {
    conflicts.push({
      type: 'STAFF_NOT_ASSIGNABLE',
      severity: 'ERROR',
      message: 'Cannot assign shifts to admin or manager accounts.',
      details: { staffRole },
    });
    return conflicts;
  }

  const sameDayShifts = await shiftRepo.findByStaffAndDate(assignedStaffId, workDate, excludeId);
  const overlapping = sameDayShifts.filter((s) => intervalsOverlap(startTime, endTime, s.startTime, s.endTime));

  // 2. OVERLAP (ERROR) — newStart < existEnd && newEnd > existStart
  if (overlapping.length) {
    conflicts.push({
      type: 'OVERLAP',
      severity: 'ERROR',
      message: `Staff already has ${overlapping.length} overlapping shift(s) on this date.`,
      details: overlapping.map((s) => ({ id: s._id, startTime: s.startTime, endTime: s.endTime })),
    });
  }

  // 3. LEAVE_CONFLICT (ERROR) — approved leave on workDate
  const leave = await LeaveRequest.findOne({
    staffId: staffProfile.userId._id || staffProfile.userId,
    status: 'approved',
    startDate: { $lte: workDate },
    endDate: { $gte: workDate },
  });
  if (leave) {
    conflicts.push({
      type: 'LEAVE_CONFLICT',
      severity: 'ERROR',
      message: 'Staff has an approved leave request on this date and cannot be assigned a shift.',
      details: { leaveId: leave._id, type: leave.type, from: leave.startDate, to: leave.endDate },
    });
  }

  // 4. MAX_DAILY_HOURS (ERROR) — total > 12h on the same day
  let dailyHours = calcShiftDurationHours(startTime, endTime);
  for (const s of sameDayShifts) {
    dailyHours += s.shiftTemplateId?.durationHours ?? calcShiftDurationHours(s.startTime, s.endTime);
  }
  if (dailyHours > MAX_DAILY_HOURS) {
    conflicts.push({
      type: 'MAX_DAILY_HOURS',
      severity: 'ERROR',
      message: `Total working hours on this date would be ${dailyHours.toFixed(1)}h, exceeding the ${MAX_DAILY_HOURS}h daily limit.`,
      details: { totalHours: dailyHours, limit: MAX_DAILY_HOURS },
    });
  }

  // 6. NIGHT_SHIFT_CONTINUOUS (ERROR) — 3+ consecutive night shifts
  const proposedIsNight = isNightShift({
    startTime,
    endTime,
    shiftType: template?.shiftType,
    crossesMidnight: template?.crossesMidnight ?? crossesMidnight,
  });
  if (proposedIsNight) {
    const rangeStart = addUtcDays(workDate, -(MAX_CONSECUTIVE_NIGHT_DAYS - 1));
    const rangeEnd = addUtcDays(workDate, MAX_CONSECUTIVE_NIGHT_DAYS - 1);
    const rangeShifts = await shiftRepo.findByStaffAndDateRange(assignedStaffId, rangeStart, rangeEnd);
    const nightDates = rangeShifts
      .filter((s) => {
        if (excludeId && String(s._id) === String(excludeId)) return false;
        return isNightShift({
          startTime: s.startTime,
          endTime: s.endTime,
          shiftType: s.shiftTemplateId?.shiftType,
          crossesMidnight: s.shiftTemplateId?.crossesMidnight,
        });
      })
      .map((s) => s.workDate);

    if (hasExcessiveConsecutiveNightShifts(nightDates, workDate)) {
      conflicts.push({
        type: 'NIGHT_SHIFT_CONTINUOUS',
        severity: 'ERROR',
        message: `Staff cannot work more than ${MAX_CONSECUTIVE_NIGHT_DAYS - 1} consecutive night shifts (${MAX_CONSECUTIVE_NIGHT_DAYS} days in a row).`,
        details: { maxConsecutiveDays: MAX_CONSECUTIVE_NIGHT_DAYS },
      });
    }
  }

  // 7. ROLE_MISMATCH (ERROR) — role must match shift template type
  const shiftType = template?.shiftType;
  if (shiftType && !isRoleAllowedForShiftType(staffRole, shiftType)) {
    conflicts.push({
      type: 'ROLE_MISMATCH',
      severity: 'ERROR',
      message: `Role '${staffRole}' is not allowed for a '${shiftType}' shift.`,
      details: { staffRole, shiftType, allowedRoles: ALLOWED_ROLES_BY_SHIFT_TYPE[shiftType] },
    });
  }

  // REST_VIOLATION (WARNING) — less than 8h between consecutive shifts
  const adjacent = await shiftRepo.findAdjacentShifts(assignedStaffId, workDate);
  const currentStartMin = toMinutes(startTime);
  const currentEndMin = toMinutes(endTime) <= currentStartMin ? toMinutes(endTime) + 1440 : toMinutes(endTime);

  for (const s of adjacent) {
    if (excludeId && String(s._id) === String(excludeId)) continue;
    const sStart = toMinutes(s.startTime);
    const sEnd = toMinutes(s.endTime) <= sStart ? toMinutes(s.endTime) + 1440 : toMinutes(s.endTime);
    const gapBefore = currentStartMin - sEnd;
    const gapAfter = sStart - currentEndMin;

    if ((gapBefore > 0 && gapBefore < 480) || (gapAfter > 0 && gapAfter < 480)) {
      conflicts.push({
        type: 'REST_VIOLATION',
        severity: 'WARNING',
        message: `Less than 8 hours rest between this shift and another shift on ${new Date(s.workDate).toDateString()}.`,
        details: { conflictShiftId: s._id },
      });
      break;
    }
  }

  // OVERTIME (WARNING) — total hours in week > 48
  const { weekStart, weekEnd } = getWeekBounds(workDate);
  const weekShifts = await shiftRepo.findShiftsInWeek(assignedStaffId, weekStart, weekEnd);
  let weeklyHours = calcShiftDurationHours(startTime, endTime);
  for (const s of weekShifts) {
    if (excludeId && String(s._id) === String(excludeId)) continue;
    weeklyHours += s.shiftTemplateId?.durationHours ?? calcShiftDurationHours(s.startTime, s.endTime);
  }
  if (weeklyHours > 48) {
    conflicts.push({
      type: 'OVERTIME',
      severity: 'WARNING',
      message: `Total working hours this week would be ${weeklyHours.toFixed(1)}h, exceeding the 48h limit.`,
      details: { totalHours: weeklyHours },
    });
  }

  // UNDERSTAFFED (INFO) — uses shift template department floor when configured
  const deptFloorId = template?.department?._id || template?.department;
  if (deptFloorId && template?.minStaff > 1) {
    const count = await shiftRepo.countShiftsOnFloorAndDate(deptFloorId, workDate, excludeId);
    if (count + 1 < template.minStaff) {
      conflicts.push({
        type: 'UNDERSTAFFED',
        severity: 'INFO',
        message: `Only ${count + 1} of ${template.minStaff} required staff will be assigned to this floor on this date.`,
        details: { assigned: count + 1, required: template.minStaff, floorId: deptFloorId },
      });
    }
  }

  return conflicts;
};

const hasErrors = (conflicts) => conflicts.some((c) => c.severity === 'ERROR');

const assertNoBlockingConflicts = (conflicts) => {
  if (!hasErrors(conflicts)) return;
  throw Object.assign(new Error('Shift validation failed. Resolve ERROR-level conflicts first.'), {
    status: 400,
    conflicts,
  });
};

// ── Shift CRUD ────────────────────────────────────────────────────────────────

const createShift = async (body, actorUserId) => {
  const { name, startTime, endTime, workDate, assignedStaffId, shiftTemplateId, taskDescription, notes } = body;

  if (!name || !startTime || !endTime || !workDate || !assignedStaffId) {
    throw Object.assign(
      new Error('name, startTime, endTime, workDate, and assignedStaffId are required'),
      { status: 400 }
    );
  }

  const parsedDate = parseWorkDateUtc(workDate);
  const resolvedStaffProfileId = await resolveStaffProfileId(assignedStaffId);
  await assertNoApprovedLeaveOnDate(resolvedStaffProfileId, parsedDate);

  const conflicts = await checkConflicts({
    assignedStaffId: resolvedStaffProfileId,
    workDate: parsedDate,
    startTime,
    endTime,
    shiftTemplateId,
  });
  assertNoBlockingConflicts(conflicts);

  const shift = await shiftRepo.create({
    name,
    startTime,
    endTime,
    workDate: parsedDate,
    assignedStaffId: resolvedStaffProfileId,
    shiftTemplateId,
    taskDescription,
    notes,
    status: 'draft',
    changeLog: [{ changedBy: actorUserId, fieldsChanged: ['created'], oldValues: {}, newValues: body, reason: 'Initial creation' }],
  });

  return { shift, conflicts };
};

const publishShift = async (id, actorUserId) => {
  const shift = await shiftRepo.findById(id);
  if (!shift) throw Object.assign(new Error('Shift not found'), { status: 404 });
  if (shift.status !== 'draft')
    throw Object.assign(new Error(`Only draft shifts can be published (current status: ${shift.status})`), { status: 400 });

  const conflicts = await checkConflicts({
    assignedStaffId: shift.assignedStaffId._id || shift.assignedStaffId,
    workDate: shift.workDate,
    startTime: shift.startTime,
    endTime: shift.endTime,
    excludeId: id,
    shiftTemplateId: shift.shiftTemplateId?._id || shift.shiftTemplateId,
  });

  if (hasErrors(conflicts))
    throw Object.assign(new Error('Cannot publish: there are blocking conflicts. Resolve ERROR-level conflicts first.'), {
      status: 409,
      conflicts,
    });

  const logEntry = { changedBy: actorUserId, fieldsChanged: ['status'], oldValues: { status: 'draft' }, newValues: { status: 'published' }, reason: 'Published' };
  const updated = await shiftRepo.updateById(id, {
    status: 'published',
    publishedAt: new Date(),
    $push: { changeLog: logEntry },
  });

  return { shift: updated, conflicts };
};

const confirmShift = async (id, actorUserId) => {
  const shift = await shiftRepo.findById(id);
  if (!shift) throw Object.assign(new Error('Shift not found'), { status: 404 });
  if (shift.status !== 'published')
    throw Object.assign(new Error(`Only published shifts can be confirmed (current status: ${shift.status})`), { status: 400 });

  const logEntry = { changedBy: actorUserId, fieldsChanged: ['status'], oldValues: { status: 'published' }, newValues: { status: 'confirmed' }, reason: 'Confirmed' };
  const updated = await shiftRepo.updateById(id, {
    status: 'confirmed',
    $push: { changeLog: logEntry },
  });
  triggerReadinessSyncForWorkDate(shift.workDate);
  return updated;
};

const updateShift = async (id, body, actorUserId, isAdmin = false) => {
  const shift = await shiftRepo.findById(id);
  if (!shift) throw Object.assign(new Error('Shift not found'), { status: 404 });

  if (['completed', 'confirmed'].includes(shift.status))
    throw Object.assign(new Error(`Cannot edit a shift with status '${shift.status}'`), { status: 400 });

  if (!isAdmin) {
    const now = new Date();
    const shiftStart = new Date(shift.workDate);
    const [h, m] = shift.startTime.split(':').map(Number);
    shiftStart.setHours(h, m, 0, 0);
    const diffMs = shiftStart - now;
    if (diffMs < 2 * 60 * 60 * 1000)
      throw Object.assign(new Error('Cannot edit a shift less than 2 hours before it starts'), { status: 400 });
  }

  if (!body.changeReason || !body.changeReason.trim())
    throw Object.assign(new Error('changeReason is required when updating a shift'), { status: 400 });

  const allowedFields = ['name', 'startTime', 'endTime', 'workDate', 'assignedStaffId', 'shiftTemplateId', 'taskDescription', 'notes'];
  const oldValues = {};
  const newValues = {};
  const fieldsChanged = [];

  for (const f of allowedFields) {
    if (body[f] !== undefined && String(body[f]) !== String(shift[f])) {
      oldValues[f] = shift[f];
      newValues[f] = body[f];
      fieldsChanged.push(f);
    }
  }

  if (!fieldsChanged.length) throw Object.assign(new Error('No changes detected'), { status: 400 });

  const updatedDate = body.workDate ? parseWorkDateUtc(body.workDate) : shift.workDate;

  const resolvedUpdateStaffId = body.assignedStaffId
    ? await resolveStaffProfileId(body.assignedStaffId)
    : shift.assignedStaffId._id || shift.assignedStaffId;
  await assertNoApprovedLeaveOnDate(resolvedUpdateStaffId, updatedDate);

  const conflicts = await checkConflicts({
    assignedStaffId: resolvedUpdateStaffId,
    workDate: updatedDate,
    startTime: body.startTime || shift.startTime,
    endTime: body.endTime || shift.endTime,
    excludeId: id,
    shiftTemplateId: body.shiftTemplateId || shift.shiftTemplateId?._id || shift.shiftTemplateId,
  });
  assertNoBlockingConflicts(conflicts);

  const logEntry = {
    changedBy: actorUserId,
    fieldsChanged,
    oldValues,
    newValues,
    reason: body.changeReason,
  };

  const updatePayload = {};
  for (const f of fieldsChanged) updatePayload[f] = body[f];
  if (body.workDate) updatePayload.workDate = updatedDate;
  // Resolve assignedStaffId if it changed (could be userId or staffProfileId)
  if (body.assignedStaffId) {
    updatePayload.assignedStaffId = resolvedUpdateStaffId;
  }
  updatePayload.changeReason = body.changeReason;
  updatePayload.$push = { changeLog: logEntry };

  const updated = await shiftRepo.updateById(id, updatePayload);
  triggerReadinessSyncForWorkDate(shift.workDate);
  if (body.workDate) triggerReadinessSyncForWorkDate(updatedDate);

  return { shift: updated, conflicts };
};

const cancelShift = async (id, actorUserId, reason = 'Cancelled') => {
  const shift = await shiftRepo.findById(id);
  if (!shift) throw Object.assign(new Error('Shift not found'), { status: 404 });
  if (shift.status === 'completed')
    throw Object.assign(new Error('Cannot cancel a completed shift'), { status: 400 });

  const logEntry = { changedBy: actorUserId, fieldsChanged: ['status'], oldValues: { status: shift.status }, newValues: { status: 'cancelled' }, reason };
  const cancelled = await shiftRepo.updateById(id, { status: 'cancelled', $push: { changeLog: logEntry } });
  triggerReadinessSyncForWorkDate(shift.workDate);
  return cancelled;
};

const deleteShift = async (id) => {
  const shift = await shiftRepo.findById(id);
  if (!shift) throw Object.assign(new Error('Shift not found'), { status: 404 });
  if (shift.status !== 'draft')
    throw Object.assign(new Error('Only draft shifts can be deleted. Use cancel for other statuses.'), { status: 400 });
  await shiftRepo.deleteById(id);
  return { deleted: true };
};

const getShift = async (id) => {
  const s = await shiftRepo.findById(id);
  if (!s) throw Object.assign(new Error('Shift not found'), { status: 404 });
  return s;
};

const listShifts = async (filter = {}, options = {}) => {
  const query = {};
  if (filter.status) query.status = filter.status;
  if (filter.assignedStaffId) query.assignedStaffId = filter.assignedStaffId;
  if (filter.floorId) query.floorId = filter.floorId;
  if (filter.fromDate || filter.toDate) {
    query.workDate = {};
    if (filter.fromDate) query.workDate.$gte = new Date(filter.fromDate + 'T00:00:00.000Z');
    if (filter.toDate) query.workDate.$lte = new Date(filter.toDate + 'T23:59:59.999Z');
  }

  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 20;
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([shiftRepo.findAll(query, { skip, limit }), shiftRepo.countAll(query)]);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const getSchedule = async (fromDate, toDate, extraFilter = {}) => {
  return shiftRepo.findByDateRange(
    new Date(fromDate + 'T00:00:00.000Z'),
    new Date(toDate + 'T23:59:59.999Z'),
    extraFilter
  );
};

const previewConflicts = async (query) => {
  const { assignedStaffId, workDate, startTime, endTime, excludeId, shiftTemplateId } = query;
  if (!assignedStaffId || !workDate || !startTime || !endTime) {
    throw Object.assign(new Error('assignedStaffId, workDate, startTime, and endTime are required'), { status: 400 });
  }

  const parsedDate = parseWorkDateUtc(workDate);
  const resolvedStaffProfileId = await resolveStaffProfileId(assignedStaffId);
  const conflicts = await checkConflicts({
    assignedStaffId: resolvedStaffProfileId,
    workDate: parsedDate,
    startTime,
    endTime,
    excludeId,
    shiftTemplateId,
  });

  return { conflicts, hasErrors: hasErrors(conflicts) };
};

module.exports = {
  createShift,
  publishShift,
  confirmShift,
  updateShift,
  cancelShift,
  deleteShift,
  getShift,
  listShifts,
  getSchedule,
  checkConflicts,
  previewConflicts,
};

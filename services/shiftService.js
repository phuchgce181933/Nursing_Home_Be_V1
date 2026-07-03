const shiftRepo = require('../repositories/shiftRepository');
const shiftTemplateRepo = require('../repositories/shiftTemplateRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const leaveRequestRepo = require('../repositories/leaveRequestRepository');
const LeaveRequest = require('../models/leaveRequest');
const StaffProfile = require('../models/staffProfile');
const { triggerReadinessSyncForWorkDate } = require('./readinessSyncService');
const {
  ALLOWED_ROLES_BY_SHIFT_TYPE,
  calcShiftDurationHours,
  intervalsOverlap,
  isInvalidTimeRange,
  getStaffRole,
  isRoleAllowedForShiftType,
  isPastWorkDate,
  validateFlexibleShiftTimes,
  computeFreeTimeSlots,
  toMinutes,
  isSplitShiftRecord,
  calcOtherDayHours,
  maxSplitHoursForDay,
  calcWeeklySplitHours,
  buildSplitShiftConflicts,
} = require('../utils/shiftValidation');
const {
  todayVN,
  nowVN,
  workDateToVNString,
  getShiftStartDateTime,
  getShiftEndDateTime,
  addDaysToDateStr,
  isPastUnconfirmedCancelDeadline,
  formatTimeVN,
} = require('../utils/shiftTime');
const { isAssignableRole } = require('../utils/staffAssignment');
const { assertNoActiveCareTasksForShift } = require('../utils/careTaskGuards');
const { ensureStaffProfileForUser } = require('./staffProfileBootstrap');
const { createAuditLog } = require('../utils/auditLog');
const { apiErr, CODES } = require('../utils/apiError');

const raiseShiftErr = (code, { statusCode = 400, params, conflicts } = {}) => {
  const err = apiErr(code, { statusCode, params });
  if (conflicts) err.conflicts = conflicts;
  throw err;
};

const MANAGER_ROLES = ['admin'];
const STAFF_SHIFT_ROLES = ['doctor', 'nurse', 'caregiver', 'staff'];

const isShiftManager = (role) => MANAGER_ROLES.includes(role);

const getMinStartMinutesForWorkDate = (workDateStr) => {
  if (workDateStr !== todayVN()) return 0;
  return toMinutes(formatTimeVN(nowVN())) ?? 0;
};

const buildAvailableTimeSlots = (sameDayShifts, workDateStr) => {
  const otherHours = calcOtherDayHours(sameDayShifts);
  const maxSplitHours = maxSplitHoursForDay(otherHours);
  return computeFreeTimeSlots(sameDayShifts, {
    minStartMinutes: getMinStartMinutesForWorkDate(workDateStr),
    maxSplitHours,
  });
};

const formatShiftTimeRange = (startTime, endTime) => `${startTime}–${endTime}`;

const getAssignedStaffProfileId = (shift) =>
  String(shift.assignedStaffId?._id || shift.assignedStaffId || '');

const getActorStaffProfile = async (actorUser) => {
  let profile = await staffProfileRepo.findByUserId(actorUser._id);
  if (!profile) {
    profile = await ensureStaffProfileForUser(actorUser);
  }
  if (!profile) {
    throw apiErr(CODES.SHIFT_STAFF_PROFILE_NOT_FOUND, { statusCode: 404 });
  }
  return profile;
};

const assertActorMayConfirmShift = async (shift, actorUser) => {
  if (isShiftManager(actorUser.role)) {
    throw apiErr(CODES.SHIFT_NO_CONFIRM_PERMISSION, { statusCode: 403 });
  }
  if (!STAFF_SHIFT_ROLES.includes(actorUser.role)) {
    throw apiErr(CODES.SHIFT_NO_CONFIRM_PERMISSION, { statusCode: 403 });
  }
  const profile = await getActorStaffProfile(actorUser);
  if (getAssignedStaffProfileId(shift) !== String(profile._id)) {
    throw apiErr(CODES.SHIFT_NO_CONFIRM_PERMISSION, { statusCode: 403 });
  }
};

const assertActorMayViewShift = async (shift, actorUser) => {
  if (!actorUser || isShiftManager(actorUser.role)) return;
  const profile = await staffProfileRepo.findByUserId(actorUser._id);
  if (!profile || getAssignedStaffProfileId(shift) !== String(profile._id)) {
    throw apiErr(CODES.SHIFT_NO_VIEW_PERMISSION, { statusCode: 403 });
  }
  if (shift.status === 'draft') {
    throw apiErr(CODES.SHIFT_NO_VIEW_PERMISSION, { statusCode: 403 });
  }
};

const emptyListResult = (options = {}) => {
  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 20;
  return { data: [], total: 0, totalHours: 0, page, limit, totalPages: 0 };
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const enrichShift = (shift) => {
  if (!shift) return shift;
  const doc = shift.toObject ? shift.toObject() : { ...shift };
  if (doc.totalHours == null && doc.startTime && doc.endTime) {
    doc.totalHours = Math.round(calcShiftDurationHours(doc.startTime, doc.endTime) * 100) / 100;
  }
  return doc;
};

const getStaffNameFromShift = (shift) => {
  const staff = shift?.assignedStaffId;
  if (!staff || typeof staff !== 'object') return undefined;
  return staff.userId?.fullName || staff.staffCode || undefined;
};

const snapshotShiftForAudit = (shift) => {
  if (!shift) return null;
  const doc = enrichShift(shift);
  return {
    _id: doc._id,
    name: doc.name,
    workDate: doc.workDate,
    startTime: doc.startTime,
    endTime: doc.endTime,
    status: doc.status,
    assignedStaffId: doc.assignedStaffId?._id || doc.assignedStaffId,
    staffName: getStaffNameFromShift(doc),
    shiftTemplateId: doc.shiftTemplateId?._id || doc.shiftTemplateId,
  };
};

const buildShiftTargetName = (shift) => {
  const snap = snapshotShiftForAudit(shift);
  if (!snap) return 'Ca làm việc';
  const dateStr = workDateToVNString(snap.workDate) || String(snap.workDate).slice(0, 10);
  const staff = snap.staffName || '—';
  return `${snap.name || 'Ca'} · ${staff} · ${dateStr}`;
};

const writeShiftAuditLog = async ({
  actorUser,
  action,
  displayAction,
  shiftBefore,
  shiftAfter,
  description,
  metadata,
  req,
}) => {
  if (!actorUser) return;
  const targetId = shiftBefore?._id || shiftAfter?._id;
  await createAuditLog({
    actorUserId: actorUser._id,
    actorRole: actorUser.role,
    action,
    displayAction,
    module: 'Shift',
    businessModule: 'Shift',
    targetEntityType: 'Shift',
    targetEntityId: targetId,
    targetName: buildShiftTargetName(shiftAfter || shiftBefore),
    description,
    beforeData: snapshotShiftForAudit(shiftBefore),
    afterData: snapshotShiftForAudit(shiftAfter),
    metadata,
    req,
    performedBy: actorUser.fullName,
    performedByRole: actorUser.role,
  });
};

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
  throw apiErr(CODES.SHIFT_STAFF_PROFILE_NOT_FOUND, { statusCode: 404 });
};

const assertNoApprovedLeaveOnDate = async (staffProfileId, workDate) => {
  const profile = await StaffProfile.findById(staffProfileId).select('userId');
  if (!profile?.userId) return;

  const day = new Date(workDate);
  const dayStart = new Date(day.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const dayEnd = new Date(day.toISOString().slice(0, 10) + 'T23:59:59.999Z');

  const overlapping = await leaveRequestRepo.findApprovedOverlapping(profile.userId, dayStart, dayEnd);
  if (overlapping.length) {
    throw apiErr(CODES.SHIFT_LEAVE_BLOCKS, { statusCode: 400 });
  }
};

// ── Conflict Detection ────────────────────────────────────────────────────────

/**
 * Validates shift assignment against 7 business rules (+ optional warnings).
 * Returns array of { type, severity, message, details? }.
 */
const checkConflicts = async ({ assignedStaffId, workDate, startTime, endTime, excludeId, shiftTemplateId }) => {
  const conflicts = [];
  const template = shiftTemplateId ? await shiftTemplateRepo.findById(shiftTemplateId) : null;
  const crossesMidnight = template?.crossesMidnight ?? false;
  const workDateStr =
    typeof workDate === 'string' && workDate.length >= 10
      ? workDate.slice(0, 10)
      : workDateToVNString(workDate);

  // 8. PAST_DATE (ERROR)
  if (isPastWorkDate(workDate)) {
    conflicts.push({
      type: 'PAST_DATE',
      severity: 'ERROR',
      message: 'Không thể tạo hoặc phân công ca cho ngày trong quá khứ.',
      details: { workDate },
    });
  }

  // 1. INVALID_TIME (ERROR) — end <= start without valid overnight pattern
  if (isInvalidTimeRange(startTime, endTime, { crossesMidnight })) {
    conflicts.push({
      type: 'INVALID_TIME',
      severity: 'ERROR',
      message: 'Thời gian ca không hợp lệ: giờ kết thúc phải sau giờ bắt đầu (trừ ca qua đêm).',
      details: { startTime, endTime },
    });
    return conflicts;
  }

  // 9. CURRENT_OR_FUTURE_TIME (ERROR) — for today's date, shift start must be now/future.
  try {
    const now = nowVN();
    const startAt = getShiftStartDateTime(workDateStr, startTime);
    const endAt = getShiftEndDateTime(workDateStr, startTime, endTime);
    if (workDateStr === todayVN() && startAt < now) {
      const isEnded = endAt <= now;
      conflicts.push({
        type: 'PAST_DATE',
        severity: 'ERROR',
        message: isEnded
          ? 'Không thể phân công ca đã kết thúc so với thời điểm hiện tại.'
          : 'Không thể phân công ca đã bắt đầu trong quá khứ. Vui lòng chọn ca có giờ bắt đầu từ hiện tại trở đi.',
        details: { workDate: workDateStr, startTime, endTime },
      });
    }
  } catch {
    conflicts.push({
      type: 'INVALID_TIME',
      severity: 'ERROR',
      message: 'Không thể xác định mốc thời gian ca. Vui lòng kiểm tra lại workDate/startTime/endTime.',
      details: { workDate: workDateStr, startTime, endTime },
    });
    return conflicts;
  }

  const staffProfile = await StaffProfile.findById(assignedStaffId).populate(
    'userId',
    'role fullName isActive isBanned'
  );
  if (!staffProfile) {
    conflicts.push({
      type: 'ROLE_MISMATCH',
      severity: 'ERROR',
      message: 'Không tìm thấy hồ sơ nhân viên.',
      details: { assignedStaffId },
    });
    return conflicts;
  }

  const staffUser = staffProfile.userId;
  if (staffUser?.isBanned) {
    conflicts.push({
      type: 'STAFF_ACCOUNT_LOCKED',
      severity: 'ERROR',
      message: 'Không thể phân ca cho nhân viên có tài khoản bị khóa.',
      details: { assignedStaffId, isBanned: true },
    });
    return conflicts;
  }
  if (staffUser && staffUser.isActive === false) {
    conflicts.push({
      type: 'STAFF_ACCOUNT_INACTIVE',
      severity: 'ERROR',
      message: 'Không thể phân ca cho nhân viên có tài khoản không hoạt động.',
      details: { assignedStaffId, isActive: false },
    });
    return conflicts;
  }

  const staffRole = getStaffRole(staffProfile);
  if (!isAssignableRole(staffRole)) {
    conflicts.push({
      type: 'STAFF_NOT_ASSIGNABLE',
      severity: 'ERROR',
      message: 'Không thể phân ca cho tài khoản admin hoặc manager.',
      details: { staffRole },
    });
    return conflicts;
  }

  const sameDayShifts = await shiftRepo.findByStaffAndDate(assignedStaffId, workDate, excludeId);
  const { weekStart, weekEnd } = getWeekBounds(workDate);
  const weekShifts = await shiftRepo.findShiftsInWeek(assignedStaffId, weekStart, weekEnd);
  const overlapping = sameDayShifts.filter((s) => intervalsOverlap(startTime, endTime, s.startTime, s.endTime));


  // 2. OVERLAP (ERROR) — newStart < existEnd && newEnd > existStart
  if (overlapping.length) {
    const isFlexible = Boolean(template?.isFlexibleTime);
    const availableTimeSlots = isFlexible ? buildAvailableTimeSlots(sameDayShifts, workDateStr) : undefined;
    const overlapRanges = overlapping
      .map((s) => formatShiftTimeRange(s.startTime, s.endTime))
      .join(', ');
    const slotsHint = availableTimeSlots?.length
      ? availableTimeSlots.map((s) => `${s.displayStart}–${s.displayEnd}`).join(', ')
      : '';

    let message;
    if (isFlexible) {
      message = slotsHint
        ? `Ca gãy trùng với ca đã phân trong ngày (${overlapRanges}). Chỉ có thể đặt trong khung giờ trống: ${slotsHint}.`
        : `Ca gãy trùng với ca đã phân trong ngày (${overlapRanges}). Không còn khung giờ trống trong ngày này.`;
    } else {
      message = `Nhân viên đã có ${overlapping.length} ca trùng giờ trong ngày này.`;
    }

    conflicts.push({
      type: 'OVERLAP',
      severity: 'ERROR',
      message,
      details: {
        overlappingShifts: overlapping.map((s) => ({
          id: s._id,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
        ...(availableTimeSlots ? { availableTimeSlots } : {}),
      },
    });
  }

  // Split-shift rules (ERROR) — only when assigning SPLIT template
  if (template?.isFlexibleTime) {
    const splitHours = calcShiftDurationHours(startTime, endTime);
    const existingSplitCount = sameDayShifts.filter((s) => isSplitShiftRecord(s)).length;
    const otherHours = calcOtherDayHours(sameDayShifts);
    const weeklySplitHours = calcWeeklySplitHours(weekShifts, {
      excludeId,
      additionalSplitHours: splitHours,
    });
    conflicts.push(
      ...buildSplitShiftConflicts({
        splitHours,
        otherHours,
        existingSplitCount,
        weeklySplitHours,
      })
    );
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
      message: 'Nhân viên có đơn nghỉ đã duyệt trong ngày này và không thể được phân ca.',
      details: { leaveId: leave._id, type: leave.type, from: leave.startDate, to: leave.endDate },
    });
  }

  // 4. ROLE_MISMATCH (ERROR) — role must match shift template type
  const shiftType = template?.shiftType;
  if (shiftType && !isRoleAllowedForShiftType(staffRole, shiftType)) {
    const shiftTypeVi = { morning: 'sáng', afternoon: 'chiều', night: 'đêm', on_call: 'trực', custom: 'gãy' }[shiftType] || shiftType;
    const roleVi = { doctor: 'bác sĩ', nurse: 'điều dưỡng', caregiver: 'chăm sóc viên', staff: 'nhân viên', chef: 'đầu bếp' }[staffRole] || staffRole;
    conflicts.push({
      type: 'ROLE_MISMATCH',
      severity: 'ERROR',
      message: `Vai trò ${roleVi} không được phân ca loại ${shiftTypeVi}.`,
      details: { staffRole, shiftType, allowedRoles: ALLOWED_ROLES_BY_SHIFT_TYPE[shiftType] },
    });
  }

  // OVERTIME (WARNING) — total hours in week > 48
  let weeklyHours = calcShiftDurationHours(startTime, endTime);
  for (const s of weekShifts) {
    if (excludeId && String(s._id) === String(excludeId)) continue;
    weeklyHours +=
      s.totalHours ??
      s.shiftTemplateId?.totalHours ??
      calcShiftDurationHours(s.startTime, s.endTime);
  }
  if (weeklyHours > 48) {
    conflicts.push({
      type: 'OVERTIME',
      severity: 'WARNING',
      message: `Total working hours this week would be ${weeklyHours.toFixed(1)}h, exceeding the 48h limit.`,
      details: { totalHours: weeklyHours },
    });
  }

  return conflicts;
};

const hasErrors = (conflicts) => conflicts.some((c) => c.severity === 'ERROR');

const assertNoBlockingConflicts = (conflicts) => {
  if (!hasErrors(conflicts)) return;
  raiseShiftErr(CODES.SHIFT_CONFLICT_CHECK_FAILED, { statusCode: 400, conflicts });
};

const FORBIDDEN_DIRECT_TIME_FIELDS = ['name', 'startTime', 'endTime'];

const assertNoDirectTimeFields = (body, { isFlexibleTime = false } = {}) => {
  for (const field of FORBIDDEN_DIRECT_TIME_FIELDS) {
    if (field === 'name') {
      if (body[field] !== undefined) {
        throw apiErr(CODES.SHIFT_TEMPLATE_INVALID, {
          statusCode: 400,
          params: { field },
        });
      }
      continue;
    }
    if (!isFlexibleTime && body[field] !== undefined) {
      throw apiErr(CODES.SHIFT_TEMPLATE_INVALID, {
        statusCode: 400,
        params: { field },
      });
    }
  }
};

const loadSystemShiftTemplate = async (shiftTemplateId) => {
  if (!shiftTemplateId) {
    throw apiErr(CODES.SHIFT_TEMPLATE_ID_REQUIRED, { statusCode: 400 });
  }

  const template = await shiftTemplateRepo.findById(shiftTemplateId);
  if (!template || !template.isSystem) {
    throw apiErr(CODES.SHIFT_TEMPLATE_INVALID, { statusCode: 400 });
  }
  if (template.status !== 'active') {
    throw apiErr(CODES.SHIFT_TEMPLATE_INACTIVE, { statusCode: 400 });
  }
  return template;
};

const resolveShiftTemplate = async (shiftTemplateId, { startTime, endTime } = {}) => {
  const template = await loadSystemShiftTemplate(shiftTemplateId);

  if (template.isFlexibleTime) {
    const flexible = validateFlexibleShiftTimes(startTime, endTime);
    return {
      shiftTemplateId: template._id,
      name: `Ca gãy (${flexible.startTime}–${flexible.endTime})`,
      startTime: flexible.startTime,
      endTime: flexible.endTime,
      totalHours: flexible.totalHours,
      template,
    };
  }

  if (startTime !== undefined || endTime !== undefined) {
    throw apiErr(CODES.SHIFT_TIME_INVALID, { statusCode: 400 });
  }

  const totalHours =
    template.totalHours ??
    Math.round(calcShiftDurationHours(template.startTime, template.endTime) * 100) / 100;

  return {
    shiftTemplateId: template._id,
    name: template.name,
    startTime: template.startTime,
    endTime: template.endTime,
    totalHours,
    template,
  };
};

// ── Shift CRUD ────────────────────────────────────────────────────────────────

const createShift = async (body, actorUserId) => {
  const { workDate, assignedStaffId, shiftTemplateId, taskDescription, notes, startTime, endTime } = body;

  if (!workDate || !assignedStaffId || !shiftTemplateId) {
    throw apiErr(CODES.SHIFT_REQUIRED_FIELDS, { statusCode: 400 });
  }

  const template = await loadSystemShiftTemplate(shiftTemplateId);
  assertNoDirectTimeFields(body, { isFlexibleTime: template.isFlexibleTime });

  const { name, startTime: resolvedStart, endTime: resolvedEnd, totalHours, shiftTemplateId: resolvedTemplateId } =
    await resolveShiftTemplate(shiftTemplateId, { startTime, endTime });

  const parsedDate = parseWorkDateUtc(workDate);
  const resolvedStaffProfileId = await resolveStaffProfileId(assignedStaffId);
  await assertNoApprovedLeaveOnDate(resolvedStaffProfileId, parsedDate);

  const conflicts = await checkConflicts({
    assignedStaffId: resolvedStaffProfileId,
    workDate: parsedDate,
    startTime: resolvedStart,
    endTime: resolvedEnd,
    shiftTemplateId: resolvedTemplateId,
  });
  assertNoBlockingConflicts(conflicts);

  const shiftPayload = {
    name,
    startTime: resolvedStart,
    endTime: resolvedEnd,
    totalHours,
    workDate: parsedDate,
    assignedStaffId: resolvedStaffProfileId,
    shiftTemplateId: resolvedTemplateId,
    taskDescription,
    notes,
  };

  const shift = await shiftRepo.create({
    ...shiftPayload,
    status: 'draft',
    changeLog: [
      {
        changedBy: actorUserId,
        fieldsChanged: ['created'],
        oldValues: {},
        newValues: shiftPayload,
        reason: 'Initial creation',
      },
    ],
  });

  return { shift: enrichShift(shift), conflicts };
};

const publishShift = async (id, actorUserId) => {
  const shift = await shiftRepo.findById(id);
  if (!shift) throw apiErr(CODES.SHIFT_NOT_FOUND, { statusCode: 404 });
  if (shift.status !== 'draft')
    throw apiErr(CODES.SHIFT_PUBLISH_DRAFT_ONLY, { statusCode: 400, params: { status: shift.status } });

  const conflicts = await checkConflicts({
    assignedStaffId: shift.assignedStaffId._id || shift.assignedStaffId,
    workDate: shift.workDate,
    startTime: shift.startTime,
    endTime: shift.endTime,
    excludeId: id,
    shiftTemplateId: shift.shiftTemplateId?._id || shift.shiftTemplateId,
  });

  if (hasErrors(conflicts))
    raiseShiftErr(CODES.SHIFT_PUBLISH_CONFLICT, { statusCode: 409, conflicts });

  const logEntry = { changedBy: actorUserId, fieldsChanged: ['status'], oldValues: { status: 'draft' }, newValues: { status: 'published' }, reason: 'Published' };
  const updated = await shiftRepo.updateById(id, {
    status: 'published',
    publishedAt: new Date(),
    $push: { changeLog: logEntry },
  });

  return { shift: updated, conflicts };
};

const confirmShift = async (id, actorUser) => {
  const shift = await shiftRepo.findById(id);
  if (!shift) throw apiErr(CODES.SHIFT_NOT_FOUND, { statusCode: 404 });
  if (shift.status !== 'published')
    throw apiErr(CODES.SHIFT_CONFIRM_PUBLISHED_ONLY, { statusCode: 400, params: { status: shift.status } });

  await assertActorMayConfirmShift(shift, actorUser);

  const actorUserId = actorUser._id || actorUser;
  const logEntry = { changedBy: actorUserId, fieldsChanged: ['status'], oldValues: { status: 'published' }, newValues: { status: 'confirmed' }, reason: 'Confirmed' };
  const updated = await shiftRepo.updateById(id, {
    status: 'confirmed',
    $push: { changeLog: logEntry },
  });
  triggerReadinessSyncForWorkDate(shift.workDate);
  return updated;
};

const updateShift = async (id, body, actorUser, isAdmin = false, req = null) => {
  const actorUserId = actorUser._id;
  const shift = await shiftRepo.findById(id);
  if (!shift) throw apiErr(CODES.SHIFT_NOT_FOUND, { statusCode: 404 });

  if (['completed', 'confirmed'].includes(shift.status))
    throw apiErr(CODES.SHIFT_EDIT_STATUS_INVALID, { statusCode: 400, params: { status: shift.status } });

  if (!isAdmin) {
    const now = new Date();
    const shiftStart = new Date(shift.workDate);
    const [h, m] = shift.startTime.split(':').map(Number);
    shiftStart.setHours(h, m, 0, 0);
    const diffMs = shiftStart - now;
    if (diffMs < 2 * 60 * 60 * 1000)
      throw apiErr(CODES.SHIFT_EDIT_TOO_LATE, { statusCode: 400 });
  }

  const reason = body.changeReason?.trim() || null;

  const templateIdForAssert =
    body.shiftTemplateId !== undefined
      ? body.shiftTemplateId
      : shift.shiftTemplateId?._id || shift.shiftTemplateId;
  const templateForAssert = await loadSystemShiftTemplate(templateIdForAssert);
  assertNoDirectTimeFields(body, { isFlexibleTime: templateForAssert.isFlexibleTime });

  const allowedFields = ['workDate', 'assignedStaffId', 'shiftTemplateId', 'taskDescription', 'notes', 'startTime', 'endTime'];
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

  if (!fieldsChanged.length) throw apiErr(CODES.SHIFT_NO_CHANGES, { statusCode: 400 });

  const updatedDate = body.workDate ? parseWorkDateUtc(body.workDate) : shift.workDate;

  const resolvedUpdateStaffId = body.assignedStaffId
    ? await resolveStaffProfileId(body.assignedStaffId)
    : shift.assignedStaffId._id || shift.assignedStaffId;
  await assertNoApprovedLeaveOnDate(resolvedUpdateStaffId, updatedDate);

  const templateId =
    body.shiftTemplateId !== undefined
      ? body.shiftTemplateId
      : shift.shiftTemplateId?._id || shift.shiftTemplateId;

  const resolvedTemplate = await loadSystemShiftTemplate(templateId);
  const timeOverride = resolvedTemplate.isFlexibleTime
    ? {
        startTime: body.startTime !== undefined ? body.startTime : shift.startTime,
        endTime: body.endTime !== undefined ? body.endTime : shift.endTime,
      }
    : {};

  const { name, startTime: resolvedStart, endTime: resolvedEnd, totalHours, shiftTemplateId: resolvedTemplateId } =
    await resolveShiftTemplate(templateId, timeOverride);

  const conflicts = await checkConflicts({
    assignedStaffId: resolvedUpdateStaffId,
    workDate: updatedDate,
    startTime: resolvedStart,
    endTime: resolvedEnd,
    excludeId: id,
    shiftTemplateId: resolvedTemplateId,
  });
  assertNoBlockingConflicts(conflicts);

  const logEntry = {
    changedBy: actorUserId,
    fieldsChanged: [...fieldsChanged],
    oldValues,
    newValues,
    reason,
  };

  const currentTemplateId = String(shift.shiftTemplateId?._id || shift.shiftTemplateId || '');
  const templateChanged = String(resolvedTemplateId) !== currentTemplateId;
  const timesChanged =
    resolvedStart !== shift.startTime || resolvedEnd !== shift.endTime || name !== shift.name;

  if (templateChanged || timesChanged) {
    logEntry.fieldsChanged = [
      ...new Set([...fieldsChanged, 'shiftTemplateId', 'name', 'startTime', 'endTime', 'totalHours']),
    ];
    logEntry.oldValues = {
      ...oldValues,
      shiftTemplateId: shift.shiftTemplateId,
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      totalHours: shift.totalHours,
    };
    logEntry.newValues = {
      ...newValues,
      shiftTemplateId: resolvedTemplateId,
      name,
      startTime: resolvedStart,
      endTime: resolvedEnd,
      totalHours,
    };
  }

  const updatePayload = {
    name,
    startTime: resolvedStart,
    endTime: resolvedEnd,
    totalHours,
    shiftTemplateId: resolvedTemplateId,
    changeReason: reason,
    $push: { changeLog: logEntry },
  };

  if (body.workDate) updatePayload.workDate = updatedDate;
  if (body.assignedStaffId) updatePayload.assignedStaffId = resolvedUpdateStaffId;
  if (body.taskDescription !== undefined) updatePayload.taskDescription = body.taskDescription;
  if (body.notes !== undefined) updatePayload.notes = body.notes;

  const updated = await shiftRepo.updateById(id, updatePayload);
  triggerReadinessSyncForWorkDate(shift.workDate);
  if (body.workDate) triggerReadinessSyncForWorkDate(updatedDate);

  const updatedPopulated = await shiftRepo.findById(id);
  await writeShiftAuditLog({
    actorUser,
    action: 'UPDATE_SHIFT',
    displayAction: 'Cập nhật ca làm việc',
    shiftBefore: shift,
    shiftAfter: updatedPopulated,
    description: `Cập nhật ca ${buildShiftTargetName(shift)}. Trường đổi: ${logEntry.fieldsChanged.join(', ')}`,
    metadata: { fieldsChanged: logEntry.fieldsChanged, changeReason: reason },
    req,
  });

  return { shift: enrichShift(updated), conflicts };
};

const AUTO_CANCEL_REASON =
  'Auto-cancelled: not confirmed within 30 minutes of shift start';

const cancelShiftAsSystem = async (shift, reason = AUTO_CANCEL_REASON) => {
  const logEntry = {
    changedBy: null,
    fieldsChanged: ['status'],
    oldValues: { status: shift.status },
    newValues: { status: 'cancelled' },
    reason,
  };
  const cancelled = await shiftRepo.updateById(shift._id, {
    status: 'cancelled',
    $push: { changeLog: logEntry },
  });
  triggerReadinessSyncForWorkDate(shift.workDate);
  return cancelled;
};

const autoCancelUnconfirmedPublishedShifts = async () => {
  const fromStr = addDaysToDateStr(todayVN(), -1);
  const toStr = addDaysToDateStr(todayVN(), 1);
  const fromDate = new Date(`${fromStr}T00:00:00.000Z`);
  const toDate = new Date(`${toStr}T23:59:59.999Z`);
  const shifts = await shiftRepo.findPublishedInWorkDateRange(fromDate, toDate);
  const now = nowVN();
  let cancelled = 0;
  let skipped = 0;

  for (const shift of shifts) {
    const workDateStr = workDateToVNString(shift.workDate);
    let pastDeadline = false;
    try {
      pastDeadline = isPastUnconfirmedCancelDeadline(workDateStr, shift.startTime, now);
    } catch {
      continue;
    }
    if (!pastDeadline) continue;

    try {
      await assertNoActiveCareTasksForShift(shift._id);
    } catch (err) {
      skipped += 1;
      console.warn(
        `[shiftService] Auto-cancel skipped shift ${shift._id}: ${err.message}`
      );
      continue;
    }

    await cancelShiftAsSystem(shift);
    cancelled += 1;
  }

  return { cancelled, skipped };
};

const cancelShift = async (id, actorUser, reason = 'Cancelled', req = null) => {
  const actorUserId = actorUser._id;
  const shift = await shiftRepo.findById(id);
  if (!shift) throw apiErr(CODES.SHIFT_NOT_FOUND, { statusCode: 404 });
  if (!['published', 'confirmed'].includes(shift.status)) {
    throw apiErr(CODES.SHIFT_CANCEL_INVALID, { statusCode: 400 });
  }

  await assertNoActiveCareTasksForShift(id);

  const logEntry = { changedBy: actorUserId, fieldsChanged: ['status'], oldValues: { status: shift.status }, newValues: { status: 'cancelled' }, reason };
  await shiftRepo.updateById(id, { status: 'cancelled', $push: { changeLog: logEntry } });
  const cancelled = await shiftRepo.findById(id);
  triggerReadinessSyncForWorkDate(shift.workDate);

  await writeShiftAuditLog({
    actorUser,
    action: 'CANCEL_SHIFT',
    displayAction: 'Hủy ca làm việc',
    shiftBefore: shift,
    shiftAfter: cancelled,
    description: `Hủy ca ${buildShiftTargetName(shift)}. Lý do: ${reason}`,
    metadata: { reason, previousStatus: shift.status },
    req,
  });

  return cancelled;
};

const deleteShift = async (id) => {
  const shift = await shiftRepo.findById(id);
  if (!shift) throw apiErr(CODES.SHIFT_NOT_FOUND, { statusCode: 404 });
  if (shift.status !== 'draft')
    throw apiErr(CODES.SHIFT_DELETE_DRAFT_ONLY, { statusCode: 400 });

  await assertNoActiveCareTasksForShift(id);

  await shiftRepo.deleteById(id);
  return { deleted: true };
};

const getShift = async (id, actorUser = null) => {
  const s = await shiftRepo.findById(id);
  if (!s) throw apiErr(CODES.SHIFT_NOT_FOUND, { statusCode: 404 });
  await assertActorMayViewShift(s, actorUser);
  return enrichShift(s);
};

const buildListQuery = (filter = {}) => {
  const query = {};
  if (filter.status) query.status = filter.status;
  if (filter.assignedStaffId) query.assignedStaffId = filter.assignedStaffId;
  if (filter.floorId) query.floorId = filter.floorId;
  if (filter.fromDate || filter.toDate) {
    query.workDate = {};
    if (filter.fromDate) query.workDate.$gte = new Date(filter.fromDate + 'T00:00:00.000Z');
    if (filter.toDate) query.workDate.$lte = new Date(filter.toDate + 'T23:59:59.999Z');
  }
  return query;
};

const listShifts = async (filter = {}, options = {}, actorUser = null) => {
  let scopedFilter = { ...filter };

  if (actorUser && !isShiftManager(actorUser.role)) {
    const profile = await staffProfileRepo.findByUserId(actorUser._id);
    if (!profile) return emptyListResult(options);
    scopedFilter.assignedStaffId = profile._id;
    if (scopedFilter.status === 'draft') return emptyListResult(options);
    if (!scopedFilter.status) scopedFilter.status = { $ne: 'draft' };
  }

  const query = buildListQuery(scopedFilter);
  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 20;
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([shiftRepo.findAll(query, { skip, limit }), shiftRepo.countAll(query)]);
  const data = rows.map(enrichShift);
  const totalHours = Math.round(data.reduce((sum, s) => sum + (s.totalHours || 0), 0) * 100) / 100;
  return { data, total, totalHours, page, limit, totalPages: Math.ceil(total / limit) };
};

const listMyShifts = async (actorUser, options = {}) => {
  const profile = await getActorStaffProfile(actorUser);
  const filter = { assignedStaffId: profile._id };
  if (options.status) {
    if (options.status === 'draft') return emptyListResult(options);
    filter.status = options.status;
  } else {
    filter.status = { $ne: 'draft' };
  }
  if (options.fromDate) filter.fromDate = options.fromDate;
  if (options.toDate) filter.toDate = options.toDate;
  return listShifts(filter, options);
};

const getSchedule = async (fromDate, toDate, extraFilter = {}) => {
  const rows = await shiftRepo.findByDateRange(
    new Date(fromDate + 'T00:00:00.000Z'),
    new Date(toDate + 'T23:59:59.999Z'),
    extraFilter
  );
  const data = rows.map(enrichShift);
  const totalHours = Math.round(data.reduce((sum, s) => sum + (s.totalHours || 0), 0) * 100) / 100;
  return { data, totalHours };
};

const previewConflicts = async (query) => {
  const { assignedStaffId, workDate, excludeId, shiftTemplateId, startTime, endTime } = query;

  if (!assignedStaffId || !workDate || !shiftTemplateId) {
    throw apiErr(CODES.SHIFT_REQUIRED_FIELDS, { statusCode: 400 });
  }

  const {
    startTime: resolvedStart,
    endTime: resolvedEnd,
    shiftTemplateId: resolvedTemplateId,
    template,
  } = await resolveShiftTemplate(shiftTemplateId, { startTime, endTime });

  const parsedDate = parseWorkDateUtc(workDate);
  const workDateStr =
    typeof workDate === 'string' && workDate.length >= 10
      ? workDate.slice(0, 10)
      : workDateToVNString(parsedDate);
  const resolvedStaffProfileId = await resolveStaffProfileId(assignedStaffId);

  let availableTimeSlots;
  if (template?.isFlexibleTime) {
    const sameDayShifts = await shiftRepo.findByStaffAndDate(
      resolvedStaffProfileId,
      parsedDate,
      excludeId
    );
    availableTimeSlots = buildAvailableTimeSlots(sameDayShifts, workDateStr);
  }

  const conflicts = await checkConflicts({
    assignedStaffId: resolvedStaffProfileId,
    workDate: parsedDate,
    startTime: resolvedStart,
    endTime: resolvedEnd,
    excludeId,
    shiftTemplateId: resolvedTemplateId,
  });

  return {
    conflicts,
    hasErrors: hasErrors(conflicts),
    ...(availableTimeSlots ? { availableTimeSlots } : {}),
  };
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
  listMyShifts,
  getSchedule,
  checkConflicts,
  previewConflicts,
  autoCancelUnconfirmedPublishedShifts,
};

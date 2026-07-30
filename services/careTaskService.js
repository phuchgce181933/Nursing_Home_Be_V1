const { apiErr, apiSuccess, CODES, SUCCESS } = require('../utils/apiError');
const careTaskRepo = require('../repositories/careTaskRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const userRepo = require('../repositories/userRepository');
const shiftRepo = require('../repositories/shiftRepository');
const leaveRequestRepo = require('../repositories/leaveRequestRepository');
const { CARE_TASK_TYPES, CARE_TASK_STATUSES, CARE_LEVELS, CARE_TASK_ASSIGNEE_ROLES } = require('../models/enums');
const { triggerReadinessSyncForWorkDate } = require('./readinessSyncService');
const {
  assertAssignableStaffProfile,
  assertCareTaskAssigneeRole,
  assertActorOwnsCareTask,
  residentCoversStaffArea,
} = require('../utils/staffAssignment');
const Resident = require('../models/resident');
const StaffProfile = require('../models/staffProfile');
const {
  parseWorkDate,
  toMinutes,
  todayVN,
  nowVN,
  formatTimeVN,
  workDateToVNString,
  buildTaskDateTime,
  getShiftEndDateTime,
  isShiftEnded,
} = require('../utils/shiftTime');
const {
  assertNoClinicalAppointmentAtTime,
  assertStaffDutyMinGap,
} = require('../utils/careTaskAssignmentValidation');
const { getTaskTypeOptions, getCareLevelOptions } = require('../utils/careTaskLabels');

const AUTO_MISSED_NOTE = 'Tự động bỏ lỡ: đã hết ca làm việc.';
const LEGACY_AUTO_SKIP_NOTE_FRAGMENT = 'Tự động bỏ qua: đã hết ca';

const VALID_TRANSITIONS = {
  pending: ['in_progress', 'skipped'],
  in_progress: ['completed', 'skipped'],
  completed: [],
  skipped: [],
  missed: [],
};

const MANUAL_STATUS_UPDATES = ['in_progress', 'completed', 'skipped'];

const resolveStaffProfileId = async (staffProfileId, userId) => {
  if (staffProfileId) {
    const byProfile = await staffProfileRepo.findById(staffProfileId);
    if (byProfile) return byProfile;
  }
  if (userId) {
    const byUser = await staffProfileRepo.findByUserId(userId);
    if (byUser) return byUser;
  }
  throw apiErr(CODES.STAFF_PROFILE_NOT_FOUND, { statusCode: 404 });
};

const buildShiftTimeLabel = (shifts) =>
  shifts.length ? shifts.map((s) => `${s.startTime} – ${s.endTime}`).join(', ') : '';

const isScheduledTimeWithinShift = (scheduledTime, shift) => {
  const scheduledMinutes = toMinutes(scheduledTime);
  const startMinutes = toMinutes(shift.startTime);
  const endMinutes = toMinutes(shift.endTime);
  if (scheduledMinutes === null || startMinutes === null || endMinutes === null) return false;

  // Overnight shift: e.g. 22:00 -> 06:00
  if (endMinutes <= startMinutes) {
    return scheduledMinutes >= startMinutes || scheduledMinutes <= endMinutes;
  }
  return scheduledMinutes >= startMinutes && scheduledMinutes <= endMinutes;
};

const parseWorkDateStr = (workDateInput) => {
  if (!workDateInput) throw apiErr(CODES.WORK_DATE_REQUIRED, { statusCode: 400 });
  try {
    const workDateStr = String(workDateInput).trim();
    parseWorkDate(workDateStr);
    return workDateStr;
  } catch {
    throw apiErr(CODES.WORK_DATE_INVALID_FORMAT, { statusCode: 400 });
  }
};

const assertWorkDateNotPast = (workDateStr) => {
  if (workDateStr < todayVN()) {
    throw apiErr(CODES.CARE_TASK_PAST_DATE, { statusCode: 400 });
  }
};

const filterShiftsNotEnded = (shifts, workDateStr) => {
  const today = todayVN();
  if (workDateStr > today) return shifts;
  return shifts.filter(
    (s) => !isShiftEnded(workDateStr, s.startTime, s.endTime, nowVN())
  );
};

const migrateLegacyAutoSkippedToMissed = async (workDatesToSync) => {
  const legacy = await careTaskRepo.findSkippedWithLegacyAutoShiftNote();
  for (const task of legacy) {
    const existingNotes = task.notes?.trim() || '';
    const notes = existingNotes.includes(LEGACY_AUTO_SKIP_NOTE_FRAGMENT)
      ? existingNotes.replace(/Tự động bỏ qua: đã hết ca làm việc\.?/g, AUTO_MISSED_NOTE)
      : AUTO_MISSED_NOTE;
    await careTaskRepo.updateById(task._id, {
      status: 'missed',
      notes: notes.includes(AUTO_MISSED_NOTE) ? notes : AUTO_MISSED_NOTE,
    });
    if (task.workDate) {
      workDatesToSync.add(workDateToVNString(task.workDate));
    }
  }
  return legacy.length;
};

const autoSkipTasksPastShiftEnd = async () => {
  const workDatesToSync = new Set();
  const migrated = await migrateLegacyAutoSkippedToMissed(workDatesToSync);

  const tasks = await careTaskRepo.findActiveWithShift();
  const now = nowVN();
  let missedCount = 0;

  for (const task of tasks) {
    const shift = task.shiftId;
    if (!shift?.startTime || !shift?.endTime) continue;

    const shiftWorkDateStr = workDateToVNString(shift.workDate);
    let shiftEnd;
    try {
      shiftEnd = getShiftEndDateTime(shiftWorkDateStr, shift.startTime, shift.endTime);
    } catch {
      continue;
    }

    if (shiftEnd > now) continue;

    const existingNotes = task.notes?.trim() || '';
    const notes = existingNotes.includes(AUTO_MISSED_NOTE)
      ? existingNotes
      : existingNotes
        ? `${existingNotes}\n${AUTO_MISSED_NOTE}`
        : AUTO_MISSED_NOTE;

    await careTaskRepo.updateById(task._id, { status: 'missed', notes });
    missedCount += 1;
    if (task.workDate) {
      workDatesToSync.add(workDateToVNString(task.workDate));
    }
  }

  for (const wd of workDatesToSync) {
    triggerReadinessSyncForWorkDate(wd);
  }

  return { missed: missedCount, migrated };
};

const getAssignmentContext = async (workDateInput) => {
  const workDateStr = parseWorkDateStr(workDateInput);
  assertWorkDateNotPast(workDateStr);
  const checkDate = parseWorkDate(workDateStr);
  const today = todayVN();
  const now = nowVN();

  const users = await userRepo.findStaffUsers(
    { role: { $in: CARE_TASK_ASSIGNEE_ROLES }, isActive: true, isBanned: false },
    { skip: 0, limit: 1000 }
  );

  const userIds = users.map((u) => u._id);
  const profiles = await staffProfileRepo.findByUserIdList(userIds);
  const profileByUserId = Object.fromEntries(
    profiles.map((p) => [p.userId.toString(), p])
  );

  const profileIds = profiles.map((p) => p._id);
  const allShifts = await shiftRepo.findShiftsByStaffIdsOnDate(profileIds, checkDate);

  const shiftsByProfileId = allShifts.reduce((acc, s) => {
    const pid = s.assignedStaffId.toString();
    if (!acc[pid]) acc[pid] = [];
    acc[pid].push(s);
    return acc;
  }, {});

  const staffWithShifts = users
    .map((u) => {
      const profile = profileByUserId[u._id.toString()];
      if (!profile) return null;
      const pid = profile._id.toString();
      const shiftsOnDate = filterShiftsNotEnded(
        (shiftsByProfileId[pid] || []).map((s) => ({
          _id: s._id,
          name: s.name,
          startTime: s.startTime,
          endTime: s.endTime,
          status: s.status,
        })),
        workDateStr
      );
      if (!shiftsOnDate.length) return null;
      return {
        staffProfileId: profile._id,
        userId: u._id,
        fullName: u.fullName,
        role: u.role,
        shiftsOnDate,
        shiftTimeLabel: buildShiftTimeLabel(shiftsOnDate),
      };
    })
    .filter(Boolean);

  return {
    workDate: workDateStr,
    todayVN: today,
    serverNow: now.toISOString(),
    minScheduledTime: workDateStr === today ? formatTimeVN(now) : null,
    staffWithShifts,
    taskTypes: getTaskTypeOptions(),
    careLevels: getCareLevelOptions(),
  };
};

const assignCareTask = async (body, actorUserId) => {
  const {
    staffProfileId: staffProfileIdInput,
    userId,
    residentId,
    shiftId,
    taskType,
    careLevel,
    workDate,
    scheduledTime,
    notes,
  } = body;

  if (
    (!staffProfileIdInput && !userId) ||
    !residentId ||
    !taskType ||
    !careLevel ||
    !workDate ||
    !shiftId ||
    !scheduledTime
  ) {
    throw apiErr(CODES.FIELD_REQUIRED, {
      statusCode: 400,
      params: {
        field:
          'staffProfileId (or userId), residentId, shiftId, taskType, careLevel, workDate, scheduledTime',
      },
    });
  }
  if (!CARE_TASK_TYPES.includes(taskType))
    throw apiErr(CODES.FIELD_MUST_BE_ONE_OF, {
      statusCode: 400,
      params: { field: 'taskType', allowed: CARE_TASK_TYPES.join(', ') },
    });
  if (!CARE_LEVELS.includes(careLevel))
    throw apiErr(CODES.FIELD_MUST_BE_ONE_OF, {
      statusCode: 400,
      params: { field: 'careLevel', allowed: CARE_LEVELS.join(', ') },
    });

  const profile = await resolveStaffProfileId(staffProfileIdInput, userId);
  const staffProfileId = profile._id;

  const assigneeRole = await assertAssignableStaffProfile(profile);
  assertCareTaskAssigneeRole(assigneeRole);

  const workDateStr = String(workDate).trim();
  try {
    parseWorkDate(workDateStr);
  } catch {
    throw apiErr(CODES.WORK_DATE_INVALID_FORMAT, { statusCode: 400 });
  }
  assertWorkDateNotPast(workDateStr);

  const workDateObj = new Date(workDateStr);
  const staffUserId = profile.userId?._id || profile.userId;
  const onLeave = await leaveRequestRepo.findApprovedOverlapping(staffUserId, workDateObj, workDateObj);
  if (onLeave.length) {
    throw apiErr(CODES.CARE_TASK_LEAVE_BLOCKS, { statusCode: 400 });
  }

  const shiftsOnDate = await shiftRepo.findActiveShiftsForStaffOnDate(staffProfileId, workDateObj);
  if (!shiftsOnDate.length) {
    throw apiErr(CODES.CARE_TASK_SHIFT_STATUS_INVALID, { statusCode: 400 });
  }

  const scheduledTimeTrimmed = scheduledTime?.trim();
  if (!scheduledTimeTrimmed || toMinutes(scheduledTimeTrimmed) === null) {
    throw apiErr(CODES.FIELD_INVALID_FORMAT, {
      statusCode: 400,
      params: { field: 'Giờ dự kiến', format: 'HH:mm' },
    });
  }

  const assertShiftEligibleForCareTask = (shift) => {
    if (!['published', 'confirmed'].includes(shift.status)) {
      throw apiErr(CODES.CARE_TASK_SHIFT_STATUS_INVALID, { statusCode: 400 });
    }
    const shiftDateStr = workDateToVNString(shift.workDate);
    if (shiftDateStr !== workDateStr) {
      throw apiErr(CODES.CARE_TASK_SHIFT_DATE_MISMATCH, { statusCode: 400 });
    }
  };

  const shiftMatch = shiftsOnDate.find((s) => s._id.toString() === String(shiftId));
  if (!shiftMatch) {
    throw apiErr(CODES.CARE_TASK_SHIFT_NOT_OWNED, { statusCode: 400 });
  }
  if (!isScheduledTimeWithinShift(scheduledTimeTrimmed, shiftMatch)) {
    throw apiErr(CODES.CARE_TASK_TIME_OUTSIDE_SHIFT, { statusCode: 400 });
  }

  assertShiftEligibleForCareTask(shiftMatch);

  if (isShiftEnded(workDateStr, shiftMatch.startTime, shiftMatch.endTime, nowVN())) {
    throw apiErr(CODES.CARE_TASK_SHIFT_ENDED, { statusCode: 400 });
  }

  // Kiểm tra trùng lịch với Cuộc hẹn khám (CareAppointment) cùng ngày
  const CareAppointment = require('../models/careAppointment');
  const taskStart = new Date(`${workDateStr}T${scheduledTimeTrimmed}:00+07:00`);
  const taskEnd = new Date(taskStart.getTime() + 15 * 60 * 1000);

  const apptConflict = await CareAppointment.findOne({
    $or: [{ doctorStaffId: staffProfileId }, { nurseStaffId: staffProfileId }],
    status: { $ne: 'cancelled' },
    scheduledStartAt: { $lt: taskEnd },
    scheduledEndAt: { $gt: taskStart },
  }).populate('residentId', 'fullName');

  if (apptConflict) {
    const residentName = apptConflict.residentId?.fullName || 'cư dân';
    const apptStartStr = new Date(apptConflict.scheduledStartAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
    const apptEndStr = new Date(apptConflict.scheduledEndAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
    throw apiErr('CARE_TASK_CONFLICT', {
      statusCode: 409,
      message: `Nhân viên đã bị đụng lịch với cuộc hẹn khám của ${residentName} trong khung giờ ${apptStartStr} – ${apptEndStr} cùng ngày.`,
    });
  }

  // Kiểm tra trùng lịch với Nhiệm vụ chăm sóc khác cùng thời gian
  const CareTask = require('../models/careTask');
  const existingTask = await CareTask.findOne({
    staffProfileId,
    workDate: { $gte: new Date(workDateStr + 'T00:00:00+07:00'), $lte: new Date(workDateStr + 'T23:59:59+07:00') },
    scheduledTime: scheduledTimeTrimmed,
    status: { $in: ['pending', 'in_progress'] },
  }).populate('residentId', 'fullName');

  if (existingTask) {
    const residentName = existingTask.residentId?.fullName || 'cư dân khác';
    throw apiErr('CARE_TASK_CONFLICT', {
      statusCode: 409,
      message: `Nhân viên đã được phân công nhiệm vụ chăm sóc cho ${residentName} vào lúc ${scheduledTimeTrimmed} cùng ngày.`,
    });
  }

  let effectiveAt;
  try {
    effectiveAt = buildTaskDateTime(workDateStr, scheduledTimeTrimmed);
  } catch {
    throw apiErr(CODES.FIELD_INVALID_FORMAT, {
      statusCode: 400,
      params: { field: 'scheduledTime', format: 'HH:mm' },
    });
  }
  if (effectiveAt < nowVN()) {
    throw apiErr(CODES.CARE_TASK_TIME_PAST, { statusCode: 400 });
  }

  await assertNoClinicalAppointmentAtTime(staffProfileId, assigneeRole, effectiveAt);
  await assertStaffDutyMinGap(staffProfileId, workDateObj, scheduledTimeTrimmed);

  const resolvedShiftId = shiftMatch._id;

  const resident = await Resident.findById(residentId).populate({
    path: 'roomId',
    select: 'roomNumber floorId',
  });
  if (!resident) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });

  const profileWithAreas = await StaffProfile.findById(staffProfileId)
    .populate('responsibleAreaIds')
    .populate('responsibleRoomIds');

  const assignedIds = (profileWithAreas?.assignedResidentIds || []).map((r) => String(r._id || r));
  if (!assignedIds.includes(String(residentId))) {
    throw apiErr(CODES.STAFF_RESIDENTS_OUTSIDE_AREA, { statusCode: 400 });
  }

  if (!residentCoversStaffArea(resident, profileWithAreas)) {
    throw apiErr(CODES.CARE_TASK_RESIDENT_OUTSIDE_AREA, { statusCode: 400 });
  }

  const created = await careTaskRepo.create({
    staffProfileId,
    residentId,
    shiftId: resolvedShiftId,
    taskType,
    careLevel,
    workDate: workDateObj,
    scheduledTime: scheduledTimeTrimmed,
    notes: notes?.trim(),
    assignedBy: actorUserId,
    status: 'pending',
  });

  triggerReadinessSyncForWorkDate(workDateStr);

  const task = await careTaskRepo.findById(created._id);
  return { ...apiSuccess(SUCCESS.CARE_TASK_ASSIGNED), task };
};

const assertValidObjectId = (value, label) => {
  const mongoose = require('mongoose');
  if (!mongoose.Types.ObjectId.isValid(String(value))) {
    throw apiErr(CODES.CAREGIVER_INVALID_OBJECT_ID, { statusCode: 400, params: { label } });
  }
};

const listCareTasks = async (filter = {}, options = {}) => {
  if (!filter.workDate || String(filter.workDate).trim() === '') {
    throw apiErr(CODES.WORK_DATE_REQUIRED, { statusCode: 400 });
  }

  await autoSkipTasksPastShiftEnd();

  const query = {};
  if (filter.staffProfileId) {
    assertValidObjectId(filter.staffProfileId, 'staffProfileId');
    query.staffProfileId = filter.staffProfileId;
  }
  if (filter.residentId) {
    assertValidObjectId(filter.residentId, 'residentId');
    query.residentId = filter.residentId;
  }
  if (filter.shiftId) {
    assertValidObjectId(filter.shiftId, 'shiftId');
    query.shiftId = filter.shiftId;
  }
  if (filter.status) {
    if (!CARE_TASK_STATUSES.includes(filter.status))
      throw apiErr(CODES.FIELD_MUST_BE_ONE_OF, {
        statusCode: 400,
        params: { field: 'status', allowed: CARE_TASK_STATUSES.join(', ') },
      });
    query.status = filter.status;
  }
  if (filter.taskType) {
    if (!CARE_TASK_TYPES.includes(filter.taskType))
      throw apiErr(CODES.FIELD_MUST_BE_ONE_OF, {
        statusCode: 400,
        params: { field: 'taskType', allowed: CARE_TASK_TYPES.join(', ') },
      });
    query.taskType = filter.taskType;
  }

  let checkDate;
  try {
    checkDate = parseWorkDate(String(filter.workDate).trim());
  } catch {
    throw apiErr(CODES.WORK_DATE_INVALID_FORMAT, { statusCode: 400 });
  }
  const start = new Date(checkDate);
  const end = new Date(checkDate.getTime() + 24 * 60 * 60 * 1000 - 1);
  query.workDate = { $gte: start, $lte: end };

  const page = parseInt(options.page, 10) || 1;
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    careTaskRepo.findAll(query, { skip, limit }),
    careTaskRepo.countAll(query),
  ]);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const getCareTask = async (id) => {
  await autoSkipTasksPastShiftEnd();
  const task = await careTaskRepo.findById(id);
  if (!task) throw apiErr(CODES.CARE_TASK_NOT_FOUND, { statusCode: 404 });
  return task;
};

const ASSIGNEE_ONLY_STATUSES = ['in_progress', 'completed'];

const updateCareTaskStatus = async (id, status, notes, actorUser) => {
  const task = await careTaskRepo.findById(id);
  if (!task) throw apiErr(CODES.CARE_TASK_NOT_FOUND, { statusCode: 404 });

  if (!MANUAL_STATUS_UPDATES.includes(status)) {
    throw apiErr(CODES.FIELD_MUST_BE_ONE_OF, {
      statusCode: 400,
      params: { field: 'status', allowed: MANUAL_STATUS_UPDATES.join(', ') },
    });
  }

  if (ASSIGNEE_ONLY_STATUSES.includes(status)) {
    const actorId = actorUser?._id || actorUser;
    await assertActorOwnsCareTask(task, actorId);
  }

  const allowed = VALID_TRANSITIONS[task.status];
  if (!allowed.includes(status))
    throw apiErr(CODES.CARE_TASK_STATUS_TRANSITION_INVALID, {
      statusCode: 400,
      params: { from: task.status, to: status },
    });

  const update = { status };
  if (notes) update.notes = notes.trim();

  const updated = await careTaskRepo.updateById(id, update);
  triggerReadinessSyncForWorkDate(task.workDate);
  return updated;
};

const getCareTasksByShift = async (shiftId) => {
  await autoSkipTasksPastShiftEnd();
  const tasks = await careTaskRepo.findByShift(shiftId);
  return { data: tasks, total: tasks.length };
};

const deleteCareTask = async (id) => {
  const task = await careTaskRepo.findById(id);
  if (!task) throw apiErr(CODES.CARE_TASK_NOT_FOUND, { statusCode: 404 });
  if (task.status !== 'pending')
    throw apiErr(CODES.CARE_TASK_DELETE_PENDING_ONLY, { statusCode: 400 });
  await careTaskRepo.deleteById(id);
  return { ...apiSuccess(SUCCESS.CARE_TASK_DELETED), deleted: true };
};

module.exports = {
  getAssignmentContext,
  assignCareTask,
  listCareTasks,
  getCareTask,
  updateCareTaskStatus,
  getCareTasksByShift,
  deleteCareTask,
  autoSkipTasksPastShiftEnd,
};

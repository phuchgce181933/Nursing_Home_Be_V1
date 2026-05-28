const ServiceError = require('./serviceError');
const careTaskRepo = require('../repositories/careTaskRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const userRepo = require('../repositories/userRepository');
const shiftRepo = require('../repositories/shiftRepository');
const leaveRequestRepo = require('../repositories/leaveRequestRepository');
const { CARE_TASK_TYPES, CARE_TASK_STATUSES, CARE_LEVELS, OPERATIONAL_ASSIGNABLE_ROLES } = require('../models/enums');
const { triggerReadinessSyncForWorkDate } = require('./readinessSyncService');
const { assertAssignableStaffProfile } = require('../utils/staffAssignment');
const { parseWorkDate, toMinutes } = require('../utils/shiftTime');
const { getTaskTypeOptions, getCareLevelOptions } = require('../utils/careTaskLabels');

const VALID_TRANSITIONS = {
  pending: ['in_progress', 'skipped'],
  in_progress: ['completed', 'skipped'],
  completed: [],
  skipped: [],
};

const resolveStaffProfileId = async (staffProfileId, userId) => {
  if (staffProfileId) {
    const byProfile = await staffProfileRepo.findById(staffProfileId);
    if (byProfile) return byProfile;
  }
  if (userId) {
    const byUser = await staffProfileRepo.findByUserId(userId);
    if (byUser) return byUser;
  }
  throw new ServiceError('Staff profile not found', 404);
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

const getAssignmentContext = async (workDateInput) => {
  if (!workDateInput) throw new ServiceError('workDate is required (YYYY-MM-DD)', 400);

  let workDateStr;
  let checkDate;
  try {
    workDateStr = String(workDateInput).trim();
    checkDate = parseWorkDate(workDateStr);
  } catch {
    throw new ServiceError('workDate must be YYYY-MM-DD', 400);
  }

  const users = await userRepo.findStaffUsers(
    { role: { $in: OPERATIONAL_ASSIGNABLE_ROLES }, isActive: true, isBanned: false },
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
      const shiftsOnDate = (shiftsByProfileId[pid] || []).map((s) => ({
        _id: s._id,
        name: s.name,
        startTime: s.startTime,
        endTime: s.endTime,
        status: s.status,
      }));
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

  if ((!staffProfileIdInput && !userId) || !residentId || !taskType || !careLevel || !workDate) {
    throw new ServiceError(
      'staffProfileId (or userId), residentId, taskType, careLevel, and workDate are required',
      400
    );
  }
  if (!CARE_TASK_TYPES.includes(taskType))
    throw new ServiceError(`taskType must be one of: ${CARE_TASK_TYPES.join(', ')}`, 400);
  if (!CARE_LEVELS.includes(careLevel))
    throw new ServiceError(`careLevel must be one of: ${CARE_LEVELS.join(', ')}`, 400);

  const profile = await resolveStaffProfileId(staffProfileIdInput, userId);
  const staffProfileId = profile._id;

  await assertAssignableStaffProfile(profile);

  const workDateObj = new Date(workDate);
  const staffUserId = profile.userId?._id || profile.userId;
  const onLeave = await leaveRequestRepo.findApprovedOverlapping(staffUserId, workDateObj, workDateObj);
  if (onLeave.length) {
    throw new ServiceError('Staff is on approved leave on this date and cannot be assigned tasks', 400);
  }

  const shiftsOnDate = await shiftRepo.findActiveShiftsForStaffOnDate(staffProfileId, workDateObj);
  if (!shiftsOnDate.length) {
    throw new ServiceError(
      'Staff has no published or confirmed shift on this date. Assign a shift first before creating care tasks.',
      400
    );
  }

  const scheduledTimeTrimmed = scheduledTime?.trim();
  if (scheduledTimeTrimmed && toMinutes(scheduledTimeTrimmed) === null) {
    throw new ServiceError('scheduledTime must be in HH:mm format', 400);
  }

  let resolvedShiftId;
  if (shiftId) {
    const shiftMatch = shiftsOnDate.find((s) => s._id.toString() === String(shiftId));
    if (!shiftMatch) {
      throw new ServiceError('shiftId does not belong to this staff member on the given workDate', 400);
    }
    if (scheduledTimeTrimmed && !isScheduledTimeWithinShift(scheduledTimeTrimmed, shiftMatch)) {
      throw new ServiceError('scheduledTime must be within the selected shift time range', 400);
    }
    resolvedShiftId = shiftMatch._id;
  } else {
    if (scheduledTimeTrimmed) {
      const matchedShift = shiftsOnDate.find((s) => isScheduledTimeWithinShift(scheduledTimeTrimmed, s));
      if (!matchedShift) {
        throw new ServiceError('scheduledTime must be within one of staff shifts on this workDate', 400);
      }
      resolvedShiftId = matchedShift._id;
    } else {
      resolvedShiftId = shiftsOnDate[0]._id;
    }
  }

  const assignedIds = (profile.assignedResidentIds || []).map((r) => String(r._id || r));
  if (!assignedIds.includes(String(residentId))) {
    throw new ServiceError(
      'Resident must be assigned to this staff in the Residents tab before creating care tasks',
      400
    );
  }

  const created = await careTaskRepo.create({
    staffProfileId,
    residentId,
    shiftId: resolvedShiftId,
    taskType,
    careLevel,
    workDate: new Date(workDate),
    scheduledTime: scheduledTimeTrimmed,
    notes: notes?.trim(),
    assignedBy: actorUserId,
    status: 'pending',
  });

  triggerReadinessSyncForWorkDate(workDate);

  const task = await careTaskRepo.findById(created._id);
  return { message: 'Care task assigned', task };
};

const listCareTasks = async (filter = {}, options = {}) => {
  const query = {};
  if (filter.staffProfileId) query.staffProfileId = filter.staffProfileId;
  if (filter.residentId) query.residentId = filter.residentId;
  if (filter.shiftId) query.shiftId = filter.shiftId;
  if (filter.status) {
    if (!CARE_TASK_STATUSES.includes(filter.status))
      throw new ServiceError(`status must be one of: ${CARE_TASK_STATUSES.join(', ')}`, 400);
    query.status = filter.status;
  }
  if (filter.taskType) query.taskType = filter.taskType;
  if (filter.workDate) {
    const d = new Date(filter.workDate);
    const start = new Date(d); start.setHours(0, 0, 0, 0);
    const end = new Date(d); end.setHours(23, 59, 59, 999);
    query.workDate = { $gte: start, $lte: end };
  }

  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 20;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    careTaskRepo.findAll(query, { skip, limit }),
    careTaskRepo.countAll(query),
  ]);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const getCareTask = async (id) => {
  const task = await careTaskRepo.findById(id);
  if (!task) throw new ServiceError('Care task not found', 404);
  return task;
};

const updateCareTaskStatus = async (id, status, notes) => {
  const task = await careTaskRepo.findById(id);
  if (!task) throw new ServiceError('Care task not found', 404);

  const allowed = VALID_TRANSITIONS[task.status];
  if (!allowed.includes(status))
    throw new ServiceError(`Cannot transition from '${task.status}' to '${status}'`, 400);

  const update = { status };
  if (notes) update.notes = notes.trim();

  const updated = await careTaskRepo.updateById(id, update);
  triggerReadinessSyncForWorkDate(task.workDate);
  return updated;
};

const getCareTasksByShift = async (shiftId) => {
  const tasks = await careTaskRepo.findByShift(shiftId);
  return { data: tasks, total: tasks.length };
};

const deleteCareTask = async (id) => {
  const task = await careTaskRepo.findById(id);
  if (!task) throw new ServiceError('Care task not found', 404);
  if (task.status !== 'pending')
    throw new ServiceError('Only pending tasks can be deleted', 400);
  await careTaskRepo.deleteById(id);
  return { deleted: true };
};

module.exports = {
  getAssignmentContext,
  assignCareTask,
  listCareTasks,
  getCareTask,
  updateCareTaskStatus,
  getCareTasksByShift,
  deleteCareTask,
};

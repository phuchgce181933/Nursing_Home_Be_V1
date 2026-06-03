const ServiceError = require('./serviceError');
const careTaskRepo = require('../repositories/careTaskRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const userRepo = require('../repositories/userRepository');
const shiftRepo = require('../repositories/shiftRepository');
const leaveRequestRepo = require('../repositories/leaveRequestRepository');
const { CARE_TASK_TYPES, CARE_TASK_STATUSES, CARE_LEVELS, OPERATIONAL_ASSIGNABLE_ROLES } = require('../models/enums');
const { triggerReadinessSyncForWorkDate } = require('./readinessSyncService');
const { assertAssignableStaffProfile, residentCoversStaffArea } = require('../utils/staffAssignment');
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
  throw new ServiceError('Không tìm thấy hồ sơ nhân viên', 404);
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
  if (!workDateInput) throw new ServiceError('workDate là bắt buộc (YYYY-MM-DD)', 400);
  try {
    const workDateStr = String(workDateInput).trim();
    parseWorkDate(workDateStr);
    return workDateStr;
  } catch {
    throw new ServiceError('workDate phải đúng định dạng YYYY-MM-DD', 400);
  }
};

const assertWorkDateNotPast = (workDateStr) => {
  if (workDateStr < todayVN()) {
    throw new ServiceError('Không thể phân công cho ngày trong quá khứ', 400);
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
    throw new ServiceError(
      'staffProfileId (hoặc userId), residentId, shiftId, taskType, careLevel, workDate và scheduledTime là bắt buộc',
      400
    );
  }
  if (!CARE_TASK_TYPES.includes(taskType))
    throw new ServiceError(`taskType phải thuộc một trong: ${CARE_TASK_TYPES.join(', ')}`, 400);
  if (!CARE_LEVELS.includes(careLevel))
    throw new ServiceError(`careLevel phải thuộc một trong: ${CARE_LEVELS.join(', ')}`, 400);

  const profile = await resolveStaffProfileId(staffProfileIdInput, userId);
  const staffProfileId = profile._id;

  await assertAssignableStaffProfile(profile);

  const workDateStr = String(workDate).trim();
  try {
    parseWorkDate(workDateStr);
  } catch {
    throw new ServiceError('workDate phải đúng định dạng YYYY-MM-DD', 400);
  }
  assertWorkDateNotPast(workDateStr);

  const workDateObj = new Date(workDateStr);
  const staffUserId = profile.userId?._id || profile.userId;
  const onLeave = await leaveRequestRepo.findApprovedOverlapping(staffUserId, workDateObj, workDateObj);
  if (onLeave.length) {
    throw new ServiceError('Nhân viên đang có đơn nghỉ đã duyệt trong ngày này nên không thể được giao nhiệm vụ', 400);
  }

  const shiftsOnDate = await shiftRepo.findActiveShiftsForStaffOnDate(staffProfileId, workDateObj);
  if (!shiftsOnDate.length) {
    throw new ServiceError(
      'Nhân viên không có ca đã đăng hoặc đã xác nhận trong ngày này. Hãy phân ca trước khi tạo nhiệm vụ chăm sóc.',
      400
    );
  }

  const scheduledTimeTrimmed = scheduledTime?.trim();
  if (!scheduledTimeTrimmed || toMinutes(scheduledTimeTrimmed) === null) {
    throw new ServiceError('scheduledTime phải đúng định dạng HH:mm', 400);
  }

  const assertShiftEligibleForCareTask = (shift) => {
    if (!['published', 'confirmed'].includes(shift.status)) {
      throw new ServiceError('Ca phải ở trạng thái đã đăng hoặc đã xác nhận để giao nhiệm vụ chăm sóc', 400);
    }
    const shiftDateStr = workDateToVNString(shift.workDate);
    if (shiftDateStr !== workDateStr) {
      throw new ServiceError('workDate của ca phải trùng với workDate của nhiệm vụ chăm sóc', 400);
    }
  };

  const shiftMatch = shiftsOnDate.find((s) => s._id.toString() === String(shiftId));
  if (!shiftMatch) {
    throw new ServiceError('shiftId không thuộc nhân viên này trong workDate đã chọn', 400);
  }
  if (!isScheduledTimeWithinShift(scheduledTimeTrimmed, shiftMatch)) {
    throw new ServiceError('scheduledTime phải nằm trong khung thời gian của ca đã chọn', 400);
  }

  assertShiftEligibleForCareTask(shiftMatch);

  if (isShiftEnded(workDateStr, shiftMatch.startTime, shiftMatch.endTime, nowVN())) {
    throw new ServiceError('Không thể phân công nhiệm vụ cho ca đã kết thúc', 400);
  }

  let effectiveAt;
  try {
    effectiveAt = buildTaskDateTime(workDateStr, scheduledTimeTrimmed);
  } catch {
    throw new ServiceError('scheduledTime phải đúng định dạng HH:mm', 400);
  }
  if (effectiveAt < nowVN()) {
    throw new ServiceError('Thời gian nhiệm vụ phải từ thời điểm hiện tại trở đi', 400);
  }

  const resolvedShiftId = shiftMatch._id;

  const resident = await Resident.findById(residentId).populate({
    path: 'roomId',
    select: 'roomNumber floorId',
  });
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);

  const profileWithAreas = await StaffProfile.findById(staffProfileId)
    .populate('responsibleAreaIds')
    .populate('responsibleRoomIds');

  const assignedIds = (profileWithAreas?.assignedResidentIds || []).map((r) => String(r._id || r));
  if (!assignedIds.includes(String(residentId))) {
    throw new ServiceError(
      'Cư dân phải được gán cho nhân viên này ở tab Cư dân trước khi tạo nhiệm vụ chăm sóc',
      400
    );
  }

  if (!residentCoversStaffArea(resident, profileWithAreas)) {
    throw new ServiceError(
      'Cư dân không thuộc tầng/phòng phụ trách của nhân viên. Hãy cập nhật khu vực hoặc phân công cư dân trước.',
      400
    );
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
  return { message: 'Giao nhiệm vụ chăm sóc thành công', task };
};

const assertValidObjectId = (value, label) => {
  const mongoose = require('mongoose');
  if (!mongoose.Types.ObjectId.isValid(String(value))) {
    throw new ServiceError(`${label} không hợp lệ`, 400);
  }
};

const listCareTasks = async (filter = {}, options = {}) => {
  if (!filter.workDate || String(filter.workDate).trim() === '') {
    throw new ServiceError('workDate là bắt buộc (YYYY-MM-DD)', 400);
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
      throw new ServiceError(`status phải thuộc một trong: ${CARE_TASK_STATUSES.join(', ')}`, 400);
    query.status = filter.status;
  }
  if (filter.taskType) {
    if (!CARE_TASK_TYPES.includes(filter.taskType))
      throw new ServiceError(`taskType phải thuộc một trong: ${CARE_TASK_TYPES.join(', ')}`, 400);
    query.taskType = filter.taskType;
  }

  let checkDate;
  try {
    checkDate = parseWorkDate(String(filter.workDate).trim());
  } catch {
    throw new ServiceError('workDate phải đúng định dạng YYYY-MM-DD', 400);
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
  if (!task) throw new ServiceError('Không tìm thấy nhiệm vụ chăm sóc', 404);
  return task;
};

const updateCareTaskStatus = async (id, status, notes) => {
  const task = await careTaskRepo.findById(id);
  if (!task) throw new ServiceError('Không tìm thấy nhiệm vụ chăm sóc', 404);

  if (!MANUAL_STATUS_UPDATES.includes(status)) {
    throw new ServiceError(
      'Chỉ có thể cập nhật thủ công sang in_progress, completed hoặc skipped (bỏ qua). Trạng thái missed (bỏ lỡ) do hệ thống tự gán khi hết ca.',
      400
    );
  }

  const allowed = VALID_TRANSITIONS[task.status];
  if (!allowed.includes(status))
    throw new ServiceError(`Không thể chuyển trạng thái từ '${task.status}' sang '${status}'`, 400);

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
  if (!task) throw new ServiceError('Không tìm thấy nhiệm vụ chăm sóc', 404);
  if (task.status !== 'pending')
    throw new ServiceError('Chỉ có thể xóa nhiệm vụ ở trạng thái chờ', 400);
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
  autoSkipTasksPastShiftEnd,
};

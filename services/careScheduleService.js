const mongoose = require('mongoose');
const { apiErr, apiSuccess, ApiError, CODES, SUCCESS } = require('../utils/apiError');
const careScheduleDayRepo = require('../repositories/careScheduleDayRepository');
const careScheduleEntryRepo = require('../repositories/careScheduleEntryRepository');
const Resident = require('../models/resident');
const StaffProfile = require('../models/staffProfile');
const Shift = require('../models/shift');
const CareTask = require('../models/careTask');
const { CARE_TASK_TYPES, CARE_LEVELS } = require('../models/enums');
const {
  parseWorkDate,
  todayVN,
  toMinutes,
  isShiftEnded,
  workDateToVNString,
  nowVN,
  buildTaskDateTime,
} = require('../utils/shiftTime');
const { triggerReadinessSyncForWorkDate } = require('./readinessSyncService');
const { assertAssignableStaffProfile, residentCoversStaffArea } = require('../utils/staffAssignment');
const { assertResidentAssignedToStaffProfile } = require('./assignedResidentService');
const {
  assertNoClinicalAppointmentAtTime,
  assertStaffDutyMinGap,
  assertBatchStaffDutyMinGap,
} = require('../utils/careTaskAssignmentValidation');

const SCHEDULE_TEMPLATES = [
  {
    key: 'basic-morning',
    name: 'Chăm sóc buổi sáng cơ bản',
    description: 'Gói chăm sóc nhẹ buổi sáng, phù hợp cư dân ổn định.',
    recommendedFor: ['low', 'medium'],
    entries: [
      {
        taskType: 'morning_care',
        careLevel: 'medium',
        scheduledTime: '08:30',
        notes: 'Hỗ trợ vệ sinh cá nhân và kiểm tra dấu hiệu sinh tồn',
      },
      {
        taskType: 'meal_assistance',
        careLevel: 'low',
        scheduledTime: '11:30',
        notes: 'Hỗ trợ ăn trưa và theo dõi lượng ăn',
      },
    ],
  },
  {
    key: 'medication-focus',
    name: 'Theo dõi thuốc trong ngày',
    description: 'Tập trung các mốc cấp phát/nhắc thuốc trong ngày.',
    recommendedFor: ['high'],
    entries: [
      {
        taskType: 'medication',
        careLevel: 'high',
        scheduledTime: '09:00',
        notes: 'Đối chiếu đơn thuốc và ghi nhận phản ứng sau uống',
      },
      {
        taskType: 'medication',
        careLevel: 'high',
        scheduledTime: '15:00',
        notes: 'Nhắc lại thuốc chiều và theo dõi tác dụng phụ',
      },
    ],
  },
  {
    key: 'rehab-check',
    name: 'Vật lý trị liệu và kiểm tra tối',
    description: 'Kết hợp phục hồi chức năng và kiểm tra cuối ngày.',
    recommendedFor: ['medium', 'high'],
    entries: [
      {
        taskType: 'physical_therapy',
        careLevel: 'medium',
        scheduledTime: '10:00',
        notes: 'Tập vận động theo chỉ định',
      },
      {
        taskType: 'evening_check',
        careLevel: 'medium',
        scheduledTime: '19:30',
        notes: 'Đánh giá tổng quan trước giờ nghỉ',
      },
    ],
  },
];

const VALID_ENTRY_SOURCES = ['template', 'manual'];
const NON_TX_ERROR_PATTERNS = [
  /retryable writes/i,
  /replica set/i,
  /Transaction numbers are only allowed on a replica set member or mongos/i,
  /does not support transactions/i,
];

const isNonTransactionEnvironmentError = (err) =>
  NON_TX_ERROR_PATTERNS.some((re) => re.test(String(err?.message || '')));

const runWithOptionalTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } catch (err) {
    if (isNonTransactionEnvironmentError(err)) {
      console.warn('[careScheduleService] Transaction unsupported, fallback to non-transaction mode:', err.message);
      return work(null);
    }
    throw err;
  } finally {
    await session.endSession();
  }
};

const assertValidObjectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value))) {
    throw apiErr(CODES.MEAL_OBJECT_ID_INVALID, { statusCode: 400, params: { label } });
  }
};

const parseAndValidateWorkDate = (workDate) => {
  const str = String(workDate || '').trim();
  try {
    parseWorkDate(str);
  } catch {
    throw apiErr(CODES.CARE_SCHEDULE_WORK_DATE_INVALID, { statusCode: 400 });
  }
  return str;
};

const validateAndNormalizeEntry = (entry, index) => {
  const row = entry || {};
  const source = row.source || 'manual';
  if (!VALID_ENTRY_SOURCES.includes(source)) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_SOURCE_INVALID, {
      statusCode: 400,
      params: { index, allowed: VALID_ENTRY_SOURCES.join(', ') },
    });
  }
  if (!CARE_TASK_TYPES.includes(row.taskType)) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_TASK_TYPE_INVALID, {
      statusCode: 400,
      params: { index, allowed: CARE_TASK_TYPES.join(', ') },
    });
  }
  if (!CARE_LEVELS.includes(row.careLevel)) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_CARE_LEVEL_INVALID, {
      statusCode: 400,
      params: { index, allowed: CARE_LEVELS.join(', ') },
    });
  }
  if (toMinutes(row.scheduledTime) === null) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_TIME_INVALID, { statusCode: 400, params: { index } });
  }
  assertValidObjectId(row.residentId, `entries[${index}].residentId`);
  assertValidObjectId(row.staffProfileId, `entries[${index}].staffProfileId`);
  assertValidObjectId(row.shiftId, `entries[${index}].shiftId`);

  return {
    residentId: String(row.residentId),
    staffProfileId: String(row.staffProfileId),
    shiftId: String(row.shiftId),
    taskType: row.taskType,
    careLevel: row.careLevel,
    scheduledTime: row.scheduledTime.trim(),
    notes: row.notes?.trim(),
    source,
    templateKey: row.templateKey?.trim(),
  };
};

const idOf = (value) => String(value?._id || value || '');

const assertEntryTimesFromNow = (entries, workDateStr) => {
  if (workDateStr !== todayVN()) return;
  const now = nowVN();
  for (const [index, entry] of entries.entries()) {
    try {
      const scheduledAt = buildTaskDateTime(workDateStr, entry.scheduledTime);
      if (scheduledAt < now) {
        throw apiErr(CODES.CARE_SCHEDULE_ENTRY_TIME_PAST, { statusCode: 400, params: { index } });
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw apiErr(CODES.CARE_SCHEDULE_ENTRY_TIME_INVALID, { statusCode: 400, params: { index } });
    }
  }
};

const hydrateDraft = async (day) => {
  if (!day) return null;
  const entries = await careScheduleEntryRepo.findByDayId(day._id);
  return { ...day.toObject(), entries };
};

const getScheduleTemplates = async () => ({
  metadata: {
    version: 'v1',
    timezone: 'Asia/Ho_Chi_Minh',
    entrySourceOptions: VALID_ENTRY_SOURCES,
  },
  enums: {
    taskTypes: CARE_TASK_TYPES,
    careLevels: CARE_LEVELS,
  },
  fieldGuide: {
    required: ['residentId', 'staffProfileId', 'shiftId', 'taskType', 'careLevel', 'scheduledTime'],
    optional: ['notes', 'source', 'templateKey'],
  },
  data: SCHEDULE_TEMPLATES.map((template) => ({
    ...template,
    entries: template.entries.map((entry) => ({
      ...entry,
      source: 'template',
      templateKey: template.key,
    })),
  })),
});

const createDraft = async (body, actorUserId) => {
  const workDate = parseAndValidateWorkDate(body.workDate);
  if (workDate < todayVN()) {
    throw apiErr(CODES.CARE_SCHEDULE_PAST_DATE, { statusCode: 400 });
  }

  const entriesInput = Array.isArray(body.entries) ? body.entries : [];
  if (!entriesInput.length) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRIES_REQUIRED, { statusCode: 400 });
  }
  const entries = entriesInput.map(validateAndNormalizeEntry);
  assertEntryTimesFromNow(entries, workDate);
  const residentIds = [...new Set(entries.map((e) => e.residentId))];
  if (residentIds.length < 1) {
    throw apiErr(CODES.CARE_SCHEDULE_NO_RESIDENTS, { statusCode: 400 });
  }
  for (const entry of entries) {
    await assertResidentAssignedToStaffProfile(entry.staffProfileId, entry.residentId);
  }

  let createdDayId;
  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    const day = await careScheduleDayRepo.create(
      {
        workDate: new Date(workDate),
        title: body.title?.trim() || `Lịch chăm sóc ngày ${workDate}`,
        status: 'draft',
        createdBy: actorUserId,
        changeLog: [{ changedBy: actorUserId, action: 'created', details: { entries: entries.length } }],
      },
      dbOpts
    );
    createdDayId = day._id;
    await careScheduleEntryRepo.createMany(
      entries.map((e) => ({ ...e, careScheduleDayId: day._id })),
      dbOpts
    );
  });
  const saved = await careScheduleDayRepo.findById(createdDayId);
  return { ...apiSuccess(SUCCESS.CARE_SCHEDULE_DRAFT_CREATED), schedule: await hydrateDraft(saved) };
};

const updateDraft = async (id, body, actorUserId) => {
  const day = await careScheduleDayRepo.findById(id);
  if (!day) throw apiErr(CODES.CARE_SCHEDULE_NOT_FOUND, { statusCode: 404 });
  if (day.status !== 'draft') throw apiErr(CODES.CARE_SCHEDULE_DRAFT_ONLY_EDIT, { statusCode: 400 });

  const nextWorkDate = body.workDate ? parseAndValidateWorkDate(body.workDate) : workDateToVNString(day.workDate);
  if (nextWorkDate < todayVN()) {
    throw apiErr(CODES.CARE_SCHEDULE_PAST_DATE, { statusCode: 400 });
  }

  const entriesInput = Array.isArray(body.entries) ? body.entries : null;
  const entries = entriesInput ? entriesInput.map(validateAndNormalizeEntry) : null;
  if (entries && !entries.length) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRIES_EMPTY, { statusCode: 400 });
  }
  if (entries) {
    assertEntryTimesFromNow(entries, nextWorkDate);
    const residentIds = [...new Set(entries.map((e) => e.residentId))];
    if (residentIds.length < 1) {
      throw apiErr(CODES.CARE_SCHEDULE_NO_RESIDENTS, { statusCode: 400 });
    }
    for (const entry of entries) {
      await assertResidentAssignedToStaffProfile(entry.staffProfileId, entry.residentId);
    }
  }

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    const updatePayload = {
      ...(body.title !== undefined ? { title: body.title?.trim() || null } : {}),
      ...(body.workDate ? { workDate: new Date(nextWorkDate) } : {}),
      $push: {
        changeLog: {
          changedBy: actorUserId,
          action: 'updated',
          details: {
            ...(body.workDate ? { workDate: nextWorkDate } : {}),
            ...(entries ? { entries: entries.length } : {}),
          },
        },
      },
    };
    await careScheduleDayRepo.updateById(id, updatePayload, dbOpts);
    if (entries) {
      await careScheduleEntryRepo.deleteByDayId(id, dbOpts);
      await careScheduleEntryRepo.createMany(
        entries.map((e) => ({ ...e, careScheduleDayId: id })),
        dbOpts
      );
    }
  });
  const saved = await careScheduleDayRepo.findById(id);
  return { ...apiSuccess(SUCCESS.CARE_SCHEDULE_DRAFT_UPDATED), schedule: await hydrateDraft(saved) };
};

const listSchedules = async (filter = {}, options = {}) => {
  const query = {};
  if (filter.workDate) {
    const workDate = parseAndValidateWorkDate(filter.workDate);
    const dayStart = new Date(`${workDate}T00:00:00.000Z`);
    const dayEnd = new Date(`${workDate}T23:59:59.999Z`);
    query.workDate = { $gte: dayStart, $lte: dayEnd };
  }
  if (filter.status) query.status = filter.status;

  const page = parseInt(options.page, 10) || 1;
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    careScheduleDayRepo.findAll(query, { skip, limit }),
    careScheduleDayRepo.countAll(query),
  ]);
  const data = await Promise.all(rows.map(hydrateDraft));
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const getSchedule = async (id) => {
  const day = await careScheduleDayRepo.findById(id);
  if (!day) throw apiErr(CODES.CARE_SCHEDULE_NOT_FOUND, { statusCode: 404 });
  return hydrateDraft(day);
};

const deleteDraft = async (id, actorUserId) => {
  const day = await careScheduleDayRepo.findById(id);
  if (!day) throw apiErr(CODES.CARE_SCHEDULE_NOT_FOUND, { statusCode: 404 });
  if (day.status !== 'draft') {
    throw apiErr(CODES.CARE_SCHEDULE_DRAFT_ONLY_DELETE, { statusCode: 400 });
  }

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    await careScheduleEntryRepo.deleteByDayId(id, dbOpts);
    await careScheduleDayRepo.deleteById(id, dbOpts);
  });

  return {
    ...apiSuccess(SUCCESS.CARE_SCHEDULE_DRAFT_DELETED),
    deletedId: String(id),
    deletedBy: String(actorUserId),
  };
};

const validateEntryForPublish = async (entry, workDateStr) => {
  const [resident, staffProfile, shift] = await Promise.all([
    Resident.findById(entry.residentId).populate({ path: 'roomId', select: 'roomNumber floorId' }),
    StaffProfile.findById(entry.staffProfileId)
      .populate('responsibleAreaIds')
      .populate('responsibleRoomIds')
      .populate('assignedResidentIds'),
    Shift.findById(entry.shiftId),
  ]);
  if (!resident) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_RESIDENT_NOT_FOUND, {
      statusCode: 400,
      params: { residentId: entry.residentId },
    });
  }
  if (!staffProfile) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_STAFF_NOT_FOUND, {
      statusCode: 400,
      params: { staffProfileId: entry.staffProfileId },
    });
  }
  if (!shift) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_SHIFT_NOT_FOUND, {
      statusCode: 400,
      params: { shiftId: entry.shiftId },
    });
  }

  const assigneeRole = await assertAssignableStaffProfile(staffProfile);
  if (!['published', 'confirmed'].includes(shift.status)) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_SHIFT_STATUS_INVALID, { statusCode: 400 });
  }
  if (idOf(shift.assignedStaffId) !== idOf(entry.staffProfileId)) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_SHIFT_STAFF_MISMATCH, { statusCode: 400 });
  }
  if (workDateToVNString(shift.workDate) !== workDateStr) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_SHIFT_DATE_MISMATCH, { statusCode: 400 });
  }
  if (toMinutes(entry.scheduledTime) === null) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_TIME_INVALID, { statusCode: 400 });
  }
  const start = toMinutes(shift.startTime);
  const end = toMinutes(shift.endTime);
  const target = toMinutes(entry.scheduledTime);
  const inShift = end <= start ? target >= start || target <= end : target >= start && target <= end;
  if (!inShift) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_TIME_OUTSIDE_SHIFT, {
      statusCode: 400,
      params: { scheduledTime: entry.scheduledTime, startTime: shift.startTime, endTime: shift.endTime },
    });
  }
  try {
    const scheduledAt = buildTaskDateTime(workDateStr, entry.scheduledTime);
    if (scheduledAt < nowVN()) {
      throw apiErr(CODES.CARE_SCHEDULE_ENTRY_TIME_PAST, { statusCode: 400 });
    }
    await assertNoClinicalAppointmentAtTime(
      staffProfile._id,
      assigneeRole,
      scheduledAt,
      CODES.CARE_SCHEDULE_ENTRY_APPOINTMENT_BLOCKS
    );
    await assertStaffDutyMinGap(staffProfile._id, new Date(`${workDateStr}T00:00:00.000Z`), entry.scheduledTime, {
      errorCode: CODES.CARE_SCHEDULE_ENTRY_TIME_TOO_CLOSE,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_TIME_INVALID, { statusCode: 400 });
  }
  if (isShiftEnded(workDateStr, shift.startTime, shift.endTime, nowVN())) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_SHIFT_ENDED, { statusCode: 400 });
  }
  const assignedResidentIds = (staffProfile.assignedResidentIds || []).map((r) => String(r._id || r));
  const needsResidentAssignment = !assignedResidentIds.includes(String(resident._id));
  if (!residentCoversStaffArea(resident, staffProfile)) {
    throw apiErr(CODES.CARE_SCHEDULE_ENTRY_RESIDENT_OUTSIDE_AREA, { statusCode: 400 });
  }

  return { resident, staffProfile, shift, needsResidentAssignment };
};

const publishSchedule = async (id, actorUserId) => {
  const day = await careScheduleDayRepo.findById(id);
  if (!day) throw apiErr(CODES.CARE_SCHEDULE_NOT_FOUND, { statusCode: 404 });
  if (day.status === 'published') {
    const entries = await careScheduleEntryRepo.findByDayId(id);
    return {
      ...apiSuccess(SUCCESS.CARE_SCHEDULE_PUBLISHED),
      idempotent: true,
      schedule: { ...(day.toObject ? day.toObject() : day), entries },
      createdCareTasks: 0,
    };
  }
  if (day.status !== 'draft') {
    throw apiErr(CODES.CARE_SCHEDULE_PUBLISH_STATUS_INVALID, {
      statusCode: 400,
      params: { status: day.status },
    });
  }

  const workDateStr = workDateToVNString(day.workDate);
  if (workDateStr < todayVN()) throw apiErr(CODES.CARE_SCHEDULE_PUBLISH_PAST_DATE, { statusCode: 400 });

  const entries = await careScheduleEntryRepo.findByDayId(id);
  if (!entries.length) throw apiErr(CODES.CARE_SCHEDULE_PUBLISH_EMPTY, { statusCode: 400 });

  const validatedEntries = [];
  for (const entry of entries) {
    const validated = await validateEntryForPublish(entry, workDateStr);
    validatedEntries.push({ entry, ...validated });
  }

  assertBatchStaffDutyMinGap(validatedEntries);

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    for (const row of validatedEntries) {
      const { entry, needsResidentAssignment, resident } = row;
      if (needsResidentAssignment) {
        await StaffProfile.updateOne(
          { _id: entry.staffProfileId._id || entry.staffProfileId },
          { $addToSet: { assignedResidentIds: resident._id } },
          dbOpts
        );
      }
      await CareTask.create(
        [
          {
            staffProfileId: entry.staffProfileId._id || entry.staffProfileId,
            residentId: entry.residentId._id || entry.residentId,
            shiftId: entry.shiftId._id || entry.shiftId,
            taskType: entry.taskType,
            careLevel: entry.careLevel,
            workDate: new Date(workDateStr),
            scheduledTime: entry.scheduledTime,
            notes: entry.notes,
            assignedBy: actorUserId,
            status: 'pending',
          },
        ],
        dbOpts
      );
    }
    await careScheduleDayRepo.updateById(
      id,
      {
        status: 'published',
        publishedBy: actorUserId,
        publishedAt: new Date(),
        $push: {
          changeLog: {
            changedBy: actorUserId,
            action: 'published',
            details: { entries: entries.length },
          },
        },
      },
      dbOpts
    );
  });
  triggerReadinessSyncForWorkDate(workDateStr);
  const saved = await careScheduleDayRepo.findById(id);
  return {
    ...apiSuccess(SUCCESS.CARE_SCHEDULE_PUBLISHED),
    schedule: await hydrateDraft(saved),
    createdCareTasks: entries.length,
  };
};

module.exports = {
  getScheduleTemplates,
  createDraft,
  updateDraft,
  listSchedules,
  getSchedule,
  deleteDraft,
  publishSchedule,
};

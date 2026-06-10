const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
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
    throw new ServiceError(`${label} không hợp lệ`, 400);
  }
};

const parseAndValidateWorkDate = (workDate) => {
  const str = String(workDate || '').trim();
  try {
    parseWorkDate(str);
  } catch {
    throw new ServiceError('workDate phải đúng định dạng YYYY-MM-DD', 400);
  }
  return str;
};

const validateAndNormalizeEntry = (entry, index) => {
  const row = entry || {};
  const source = row.source || 'manual';
  if (!VALID_ENTRY_SOURCES.includes(source)) {
    throw new ServiceError(`entries[${index}].source phải thuộc một trong: ${VALID_ENTRY_SOURCES.join(', ')}`, 400);
  }
  if (!CARE_TASK_TYPES.includes(row.taskType)) {
    throw new ServiceError(`entries[${index}].taskType phải thuộc một trong: ${CARE_TASK_TYPES.join(', ')}`, 400);
  }
  if (!CARE_LEVELS.includes(row.careLevel)) {
    throw new ServiceError(`entries[${index}].careLevel phải thuộc một trong: ${CARE_LEVELS.join(', ')}`, 400);
  }
  if (toMinutes(row.scheduledTime) === null) {
    throw new ServiceError(`entries[${index}].scheduledTime phải đúng định dạng HH:mm`, 400);
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
        throw new ServiceError(
          `entries[${index}].scheduledTime phải từ thời điểm hiện tại trở đi cho ngày hôm nay`,
          400
        );
      }
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError(`entries[${index}].scheduledTime phải đúng định dạng HH:mm`, 400);
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
    throw new ServiceError('Không thể tạo lịch chăm sóc cho ngày trong quá khứ', 400);
  }

  const entriesInput = Array.isArray(body.entries) ? body.entries : [];
  if (!entriesInput.length) {
    throw new ServiceError('entries là bắt buộc và không được để trống', 400);
  }
  const entries = entriesInput.map(validateAndNormalizeEntry);
  assertEntryTimesFromNow(entries, workDate);
  const residentIds = [...new Set(entries.map((e) => e.residentId))];
  if (residentIds.length < 1) {
    throw new ServiceError('Lịch nháp phải có ít nhất 1 cư dân', 400);
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
  try {
    const saved = await careScheduleDayRepo.findById(createdDayId);
    return { message: 'Tạo lịch chăm sóc nháp thành công', schedule: await hydrateDraft(saved) };
  } finally {
    // no-op
  }
};

const updateDraft = async (id, body, actorUserId) => {
  const day = await careScheduleDayRepo.findById(id);
  if (!day) throw new ServiceError('Không tìm thấy lịch chăm sóc', 404);
  if (day.status !== 'draft') throw new ServiceError('Chỉ có thể cập nhật lịch ở trạng thái nháp', 400);

  const nextWorkDate = body.workDate ? parseAndValidateWorkDate(body.workDate) : workDateToVNString(day.workDate);
  if (nextWorkDate < todayVN()) {
    throw new ServiceError('Không thể cập nhật lịch chăm sóc về ngày trong quá khứ', 400);
  }

  const entriesInput = Array.isArray(body.entries) ? body.entries : null;
  const entries = entriesInput ? entriesInput.map(validateAndNormalizeEntry) : null;
  if (entries && !entries.length) {
    throw new ServiceError('entries không được để trống', 400);
  }
  if (entries) {
    assertEntryTimesFromNow(entries, nextWorkDate);
    const residentIds = [...new Set(entries.map((e) => e.residentId))];
    if (residentIds.length < 1) {
      throw new ServiceError('Lịch nháp phải có ít nhất 1 cư dân', 400);
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
  try {
    const saved = await careScheduleDayRepo.findById(id);
    return { message: 'Cập nhật lịch chăm sóc nháp thành công', schedule: await hydrateDraft(saved) };
  } finally {
    // no-op
  }
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
  if (!day) throw new ServiceError('Không tìm thấy lịch chăm sóc', 404);
  return hydrateDraft(day);
};

const deleteDraft = async (id, actorUserId) => {
  const day = await careScheduleDayRepo.findById(id);
  if (!day) throw new ServiceError('Không tìm thấy lịch chăm sóc', 404);
  if (day.status !== 'draft') {
    throw new ServiceError('Chỉ có thể xóa lịch chăm sóc ở trạng thái nháp', 400);
  }

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    await careScheduleEntryRepo.deleteByDayId(id, dbOpts);
    await careScheduleDayRepo.deleteById(id, dbOpts);
  });

  return {
    message: 'Xóa lịch chăm sóc nháp thành công',
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
  if (!resident) throw new ServiceError(`Không tìm thấy cư dân: ${entry.residentId}`, 400);
  if (!staffProfile) throw new ServiceError(`Không tìm thấy hồ sơ nhân viên: ${entry.staffProfileId}`, 400);
  if (!shift) throw new ServiceError(`Không tìm thấy ca làm việc: ${entry.shiftId}`, 400);

  await assertAssignableStaffProfile(staffProfile);
  if (!['published', 'confirmed'].includes(shift.status)) {
    throw new ServiceError('Ca làm việc phải ở trạng thái đã đăng hoặc đã xác nhận để publish lịch', 400);
  }
  if (idOf(shift.assignedStaffId) !== idOf(entry.staffProfileId)) {
    throw new ServiceError('shiftId của entry phải thuộc đúng staffProfileId đã chọn', 400);
  }
  if (workDateToVNString(shift.workDate) !== workDateStr) {
    throw new ServiceError('workDate của ca trong entry phải trùng workDate của lịch', 400);
  }
  if (toMinutes(entry.scheduledTime) === null) {
    throw new ServiceError('scheduledTime của entry phải đúng định dạng HH:mm', 400);
  }
  const start = toMinutes(shift.startTime);
  const end = toMinutes(shift.endTime);
  const target = toMinutes(entry.scheduledTime);
  const inShift = end <= start ? target >= start || target <= end : target >= start && target <= end;
  if (!inShift) {
    throw new ServiceError(`Giờ ${entry.scheduledTime} phải nằm trong ca ${shift.startTime}-${shift.endTime}`, 400);
  }
  try {
    const scheduledAt = buildTaskDateTime(workDateStr, entry.scheduledTime);
    if (scheduledAt < nowVN()) {
      throw new ServiceError('scheduledTime của entry phải từ thời điểm hiện tại trở đi', 400);
    }
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw new ServiceError('scheduledTime của entry phải đúng định dạng HH:mm', 400);
  }
  if (isShiftEnded(workDateStr, shift.startTime, shift.endTime, nowVN())) {
    throw new ServiceError('Không thể publish entry thuộc ca đã kết thúc', 400);
  }
  const assignedResidentIds = (staffProfile.assignedResidentIds || []).map((r) => String(r._id || r));
  const needsResidentAssignment = !assignedResidentIds.includes(String(resident._id));
  if (!residentCoversStaffArea(resident, staffProfile)) {
    throw new ServiceError('Cư dân nằm ngoài khu vực/phòng phụ trách của nhân viên đã chọn', 400);
  }

  return { resident, staffProfile, shift, needsResidentAssignment };
};

const publishSchedule = async (id, actorUserId) => {
  const day = await careScheduleDayRepo.findById(id);
  if (!day) throw new ServiceError('Không tìm thấy lịch chăm sóc', 404);
  if (day.status === 'published') {
    const entries = await careScheduleEntryRepo.findByDayId(id);
    return {
      message: 'Lịch chăm sóc đã được publish trước đó',
      idempotent: true,
      schedule: { ...(day.toObject ? day.toObject() : day), entries },
      createdCareTasks: 0,
    };
  }
  if (day.status !== 'draft') throw new ServiceError(`Không thể publish lịch ở trạng thái ${day.status}`, 400);

  const workDateStr = workDateToVNString(day.workDate);
  if (workDateStr < todayVN()) throw new ServiceError('Không thể publish lịch cho ngày trong quá khứ', 400);

  const entries = await careScheduleEntryRepo.findByDayId(id);
  if (!entries.length) throw new ServiceError('Không thể publish lịch rỗng', 400);

  const validatedEntries = [];
  for (const entry of entries) {
    const validated = await validateEntryForPublish(entry, workDateStr);
    validatedEntries.push({ entry, ...validated });
  }

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
  try {
    triggerReadinessSyncForWorkDate(workDateStr);
    const saved = await careScheduleDayRepo.findById(id);
    return {
      message: 'Publish lịch chăm sóc thành công',
      schedule: await hydrateDraft(saved),
      createdCareTasks: entries.length,
    };
  } finally {
    // no-op
  }
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


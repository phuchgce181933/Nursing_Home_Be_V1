const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const mealTimeScheduleDayRepo = require('../repositories/mealTimeScheduleDayRepository');
const mealTimeScheduleEntryRepo = require('../repositories/mealTimeScheduleEntryRepository');
const Resident = require('../models/resident');
const { parseWorkDate, todayVN, nowVN, toMinutes, buildTaskDateTime, workDateToVNString } = require('../utils/shiftTime');

const NON_TX_ERROR_PATTERNS = [
  /retryable writes/i,
  /replica set/i,
  /Transaction numbers are only allowed on a replica set member or mongos/i,
  /does not support transactions/i,
];

const VALID_ENTRY_SOURCES = ['template', 'manual'];
const DEFAULT_MEAL_TIMES = { breakfast: '07:30', lunch: '11:30', dinner: '17:30' };

const MEAL_TIME_TEMPLATES = [
  {
    key: 'standard',
    name: 'Giờ ăn chuẩn',
    breakfastTime: '07:30',
    lunchTime: '11:30',
    dinnerTime: '17:30',
  },
  {
    key: 'early',
    name: 'Ăn sớm',
    breakfastTime: '06:30',
    lunchTime: '11:00',
    dinnerTime: '17:00',
  },
  {
    key: 'late',
    name: 'Ăn muộn',
    breakfastTime: '08:00',
    lunchTime: '12:00',
    dinnerTime: '18:00',
  },
];

const isNonTxErr = (err) => NON_TX_ERROR_PATTERNS.some((re) => re.test(String(err?.message || '')));

const runWithOptionalTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } catch (err) {
    if (isNonTxErr(err)) {
      console.warn('[mealTimeScheduleService] Transaction unsupported, fallback to non-transaction mode:', err.message);
      return work(null);
    }
    throw err;
  } finally {
    await session.endSession();
  }
};

const parseWorkDateStrict = (workDate) => {
  const str = String(workDate || '').trim();
  try {
    parseWorkDate(str);
  } catch {
    throw new ServiceError('workDate phải đúng định dạng YYYY-MM-DD', 400);
  }
  return str;
};

const assertValidObjectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
    throw new ServiceError(`${label} không hợp lệ`, 400);
  }
};

const normalizeTimeField = (value, fieldName, index) => {
  const trimmed = String(value || '').trim();
  if (toMinutes(trimmed) === null) {
    throw new ServiceError(`entries[${index}].${fieldName} phải đúng định dạng HH:mm`, 400);
  }
  return trimmed;
};

const validateEntry = (entry, index) => {
  const row = entry || {};
  assertValidObjectId(row.residentId, `entries[${index}].residentId`);
  if (row.source && !VALID_ENTRY_SOURCES.includes(row.source)) {
    throw new ServiceError(`entries[${index}].source phải thuộc một trong: ${VALID_ENTRY_SOURCES.join(', ')}`, 400);
  }

  return {
    residentId: String(row.residentId),
    breakfastTime: normalizeTimeField(row.breakfastTime || DEFAULT_MEAL_TIMES.breakfast, 'breakfastTime', index),
    lunchTime: normalizeTimeField(row.lunchTime || DEFAULT_MEAL_TIMES.lunch, 'lunchTime', index),
    dinnerTime: normalizeTimeField(row.dinnerTime || DEFAULT_MEAL_TIMES.dinner, 'dinnerTime', index),
    notes: row.notes?.trim(),
    source: row.source || 'manual',
    templateKey: row.templateKey?.trim(),
  };
};

const assertEntryTimesFromNow = (entries, workDateStr) => {
  if (workDateStr !== todayVN()) return;
  const now = nowVN();
  for (const [index, entry] of entries.entries()) {
    for (const field of ['breakfastTime', 'lunchTime', 'dinnerTime']) {
      try {
        const at = buildTaskDateTime(workDateStr, entry[field]);
        if (at < now) {
          throw new ServiceError(
            `entries[${index}].${field} phải từ thời điểm hiện tại trở đi cho ngày hôm nay`,
            400
          );
        }
      } catch (err) {
        if (err instanceof ServiceError) throw err;
        throw new ServiceError(`entries[${index}].${field} phải đúng định dạng HH:mm`, 400);
      }
    }
  }
};

const hydrateSchedule = async (day) => {
  if (!day) return null;
  const entries = await mealTimeScheduleEntryRepo.findByDayId(day._id);
  return { ...day.toObject(), entries };
};

const getTemplates = async () => ({
  metadata: {
    version: 'v1',
    timezone: 'Asia/Ho_Chi_Minh',
    defaultMealTimes: DEFAULT_MEAL_TIMES,
    entrySourceOptions: VALID_ENTRY_SOURCES,
  },
  templates: MEAL_TIME_TEMPLATES.map((t) => ({ ...t, source: 'template' })),
});

const listResidentsForMealTimeSchedule = async (params = {}) => {
  const query = { residencyStatus: params.status || 'admitted' };
  const search = String(params.search || '').trim();
  if (search) {
    query.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { residentCode: { $regex: search, $options: 'i' } },
    ];
  }
  const residents = await Resident.find(query)
    .select('_id residentCode fullName')
    .sort({ fullName: 1 })
    .limit(500)
    .lean();
  return { data: residents };
};

const getPublishedTimes = async (workDateInput, residentIdsInput = []) => {
  const workDate = parseWorkDateStrict(workDateInput);
  const residentIds = Array.isArray(residentIdsInput)
    ? residentIdsInput.map(String).filter((id) => mongoose.Types.ObjectId.isValid(id))
    : String(residentIdsInput || '')
        .split(',')
        .map((s) => s.trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id));

  const rows = await mealTimeScheduleEntryRepo.findByPublishedWorkDate(workDate, residentIds);
  const byResident = {};
  for (const row of rows) {
    const rid = String(row.residentId?._id || row.residentId);
    byResident[rid] = {
      breakfast: row.breakfastTime,
      lunch: row.lunchTime,
      dinner: row.dinnerTime,
    };
  }

  return {
    workDate,
    source: rows.length ? 'published_schedule' : 'system_default',
    byResident,
    defaultMealTimes: DEFAULT_MEAL_TIMES,
  };
};

/** Used by mealPlanService for auto-fill */
const resolveMealTimeForResident = async (workDateStr, residentId, mealType) => {
  const map = await getPublishedTimes(workDateStr, [String(residentId)]);
  const times = map.byResident[String(residentId)];
  if (times && times[mealType]) return times[mealType];
  return DEFAULT_MEAL_TIMES[mealType] || DEFAULT_MEAL_TIMES.breakfast;
};

const createDraft = async (body, actorUserId) => {
  const workDate = parseWorkDateStrict(body.workDate);
  if (workDate < todayVN()) {
    throw new ServiceError('Không thể tạo lịch giờ ăn cho ngày trong quá khứ', 400);
  }

  const entriesInput = Array.isArray(body.entries) ? body.entries : [];
  if (!entriesInput.length) throw new ServiceError('entries là bắt buộc và không được để trống', 400);

  const entries = entriesInput.map(validateEntry);
  assertEntryTimesFromNow(entries, workDate);

  const residentIds = [...new Set(entries.map((e) => e.residentId))];
  if (residentIds.length < 2) {
    throw new ServiceError('Lịch giờ ăn phải có ít nhất 2 cư dân', 400);
  }
  const residentCount = await Resident.countDocuments({ _id: { $in: residentIds } });
  if (residentCount !== residentIds.length) {
    throw new ServiceError('Có cư dân trong danh sách entries không tồn tại', 400);
  }

  let createdId;
  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    const day = await mealTimeScheduleDayRepo.create(
      {
        workDate: new Date(workDate),
        title: body.title?.trim() || `Lịch giờ ăn ${workDate}`,
        status: 'draft',
        createdBy: actorUserId,
        changeLog: [{ changedBy: actorUserId, action: 'created', details: { entries: entries.length } }],
      },
      dbOpts
    );
    createdId = day._id;
    await mealTimeScheduleEntryRepo.createMany(
      entries.map((e) => ({ ...e, mealTimeScheduleDayId: day._id })),
      dbOpts
    );
  });

  const saved = await mealTimeScheduleDayRepo.findById(createdId);
  return { message: 'Tạo lịch giờ ăn nháp thành công', schedule: await hydrateSchedule(saved) };
};

const updateDraft = async (id, body, actorUserId) => {
  const day = await mealTimeScheduleDayRepo.findById(id);
  if (!day) throw new ServiceError('Không tìm thấy lịch giờ ăn', 404);
  if (day.status !== 'draft') throw new ServiceError('Chỉ có thể cập nhật lịch giờ ăn ở trạng thái nháp', 400);

  const updatePayload = {};
  if (body.workDate !== undefined) {
    const workDate = parseWorkDateStrict(body.workDate);
    if (workDate < todayVN()) throw new ServiceError('Không thể cập nhật lịch giờ ăn về ngày quá khứ', 400);
    updatePayload.workDate = new Date(workDate);
  }
  if (body.title !== undefined) updatePayload.title = body.title?.trim() || null;

  const hasEntries = Array.isArray(body.entries);
  const normalizedEntries = hasEntries ? body.entries.map(validateEntry) : null;
  if (hasEntries && !normalizedEntries.length) throw new ServiceError('entries không được để trống', 400);

  const targetWorkDateStr =
    body.workDate !== undefined ? parseWorkDateStrict(body.workDate) : workDateToVNString(day.workDate);

  if (normalizedEntries) {
    assertEntryTimesFromNow(normalizedEntries, targetWorkDateStr);
  }

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    await mealTimeScheduleDayRepo.updateById(
      id,
      {
        ...updatePayload,
        $push: {
          changeLog: {
            changedBy: actorUserId,
            action: 'updated',
            details: { ...(hasEntries ? { entries: normalizedEntries.length } : {}), ...updatePayload },
          },
        },
      },
      dbOpts
    );
    if (hasEntries) {
      const residentIds = [...new Set(normalizedEntries.map((e) => e.residentId))];
      if (residentIds.length < 2) {
        throw new ServiceError('Lịch giờ ăn phải có ít nhất 2 cư dân', 400);
      }
      await mealTimeScheduleEntryRepo.deleteByDayId(id, dbOpts);
      await mealTimeScheduleEntryRepo.createMany(
        normalizedEntries.map((e) => ({ ...e, mealTimeScheduleDayId: id })),
        dbOpts
      );
    }
  });

  const saved = await mealTimeScheduleDayRepo.findById(id);
  return { message: 'Cập nhật lịch giờ ăn nháp thành công', schedule: await hydrateSchedule(saved) };
};

const listSchedules = async (filter = {}, options = {}) => {
  const query = {};
  if (filter.workDate) {
    const workDate = parseWorkDateStrict(filter.workDate);
    query.workDate = {
      $gte: new Date(`${workDate}T00:00:00.000Z`),
      $lte: new Date(`${workDate}T23:59:59.999Z`),
    };
  }
  if (filter.status) query.status = filter.status;

  const page = parseInt(options.page, 10) || 1;
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    mealTimeScheduleDayRepo.findAll(query, { skip, limit }),
    mealTimeScheduleDayRepo.countAll(query),
  ]);
  const data = await Promise.all(rows.map(hydrateSchedule));
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const getSchedule = async (id) => {
  const day = await mealTimeScheduleDayRepo.findById(id);
  if (!day) throw new ServiceError('Không tìm thấy lịch giờ ăn', 404);
  return hydrateSchedule(day);
};

const deleteDraft = async (id) => {
  const day = await mealTimeScheduleDayRepo.findById(id);
  if (!day) throw new ServiceError('Không tìm thấy lịch giờ ăn', 404);
  if (day.status !== 'draft') {
    throw new ServiceError('Chỉ có thể xóa lịch giờ ăn ở trạng thái nháp', 400);
  }

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    await mealTimeScheduleEntryRepo.deleteByDayId(id, dbOpts);
    await mealTimeScheduleDayRepo.deleteById(id, dbOpts);
  });

  return { message: 'Xóa lịch giờ ăn nháp thành công', deleted: true, id };
};

const publishSchedule = async (id, actorUserId) => {
  const day = await mealTimeScheduleDayRepo.findById(id);
  if (!day) throw new ServiceError('Không tìm thấy lịch giờ ăn', 404);
  if (day.status === 'published') {
    return { message: 'Lịch giờ ăn đã publish trước đó', idempotent: true, schedule: await hydrateSchedule(day) };
  }
  if (day.status !== 'draft') {
    throw new ServiceError(`Không thể publish lịch giờ ăn ở trạng thái ${day.status}`, 400);
  }

  const workDate = workDateToVNString(day.workDate);
  if (workDate < todayVN()) throw new ServiceError('Không thể publish lịch giờ ăn cho ngày trong quá khứ', 400);

  const entries = await mealTimeScheduleEntryRepo.findByDayId(id);
  if (!entries.length) throw new ServiceError('Không thể publish lịch giờ ăn rỗng', 400);
  assertEntryTimesFromNow(
    entries.map((e) => ({
      residentId: e.residentId,
      breakfastTime: e.breakfastTime,
      lunchTime: e.lunchTime,
      dinnerTime: e.dinnerTime,
    })),
    workDate
  );

  const residentIds = [...new Set(entries.map((e) => String(e.residentId?._id || e.residentId)))];
  if (residentIds.length < 2) {
    throw new ServiceError('Lịch giờ ăn phải có ít nhất 2 cư dân trước khi publish', 400);
  }

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    await mealTimeScheduleDayRepo.updateById(
      id,
      {
        status: 'published',
        publishedBy: actorUserId,
        publishedAt: new Date(),
        $push: { changeLog: { changedBy: actorUserId, action: 'published', details: { entries: entries.length } } },
      },
      dbOpts
    );
  });

  const saved = await mealTimeScheduleDayRepo.findById(id);
  return { message: 'Publish lịch giờ ăn thành công', schedule: await hydrateSchedule(saved) };
};

module.exports = {
  DEFAULT_MEAL_TIMES,
  getTemplates,
  listResidentsForMealTimeSchedule,
  getPublishedTimes,
  resolveMealTimeForResident,
  createDraft,
  updateDraft,
  listSchedules,
  getSchedule,
  deleteDraft,
  publishSchedule,
};

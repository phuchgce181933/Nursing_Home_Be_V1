const mongoose = require('mongoose');
const { apiErr, apiSuccess, ApiError, CODES, SUCCESS } = require('../utils/apiError');
const mealTimeScheduleDayRepo = require('../repositories/mealTimeScheduleDayRepository');
const mealTimeScheduleEntryRepo = require('../repositories/mealTimeScheduleEntryRepository');
const { listAssignedAdmittedResidentsForUser, assertResidentsAssignedToUser } = require('./assignedResidentService');
const { assertNoPublishedScheduleConflicts } = require('../utils/nutritionPublishGuards');
const residentRepo = require('../repositories/residentRepository');
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
    throw apiErr(CODES.MEAL_WORK_DATE_INVALID, { statusCode: 400 });
  }
  return str;
};

const assertValidObjectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
    throw apiErr(CODES.MEAL_OBJECT_ID_INVALID, { statusCode: 400, params: { label } });
  }
};

const normalizeTimeField = (value, fieldName, index) => {
  const trimmed = String(value || '').trim();
  if (toMinutes(trimmed) === null) {
    throw apiErr(CODES.MEAL_TIME_ENTRY_TIME_INVALID, {
      statusCode: 400,
      params: { index, field: fieldName },
    });
  }
  return trimmed;
};

const validateEntry = (entry, index) => {
  const row = entry || {};
  assertValidObjectId(row.residentId, `entries[${index}].residentId`);
  if (row.source && !VALID_ENTRY_SOURCES.includes(row.source)) {
    throw apiErr(CODES.MEAL_ENTRY_SOURCE_INVALID, {
      statusCode: 400,
      params: { index, allowed: VALID_ENTRY_SOURCES.join(', ') },
    });
  }

  const breakfastTime = normalizeTimeField(row.breakfastTime || DEFAULT_MEAL_TIMES.breakfast, 'breakfastTime', index);
  const lunchTime = normalizeTimeField(row.lunchTime || DEFAULT_MEAL_TIMES.lunch, 'lunchTime', index);
  const dinnerTime = normalizeTimeField(row.dinnerTime || DEFAULT_MEAL_TIMES.dinner, 'dinnerTime', index);
  if (!(toMinutes(breakfastTime) < toMinutes(lunchTime) && toMinutes(lunchTime) < toMinutes(dinnerTime))) {
    throw apiErr(CODES.MEAL_TIME_ENTRY_TIME_INVALID, {
      statusCode: 400,
      message: `entries[${index}]: giờ ăn sáng phải trước giờ ăn trưa, và giờ ăn trưa phải trước giờ ăn tối`,
      params: { index, field: 'mealTimeOrder' },
    });
  }
  if (row.notes && String(row.notes).trim().length > 500) {
    throw apiErr(CODES.RESIDENT_LIST_ITEM_LENGTH_INVALID, { statusCode: 400, params: { field: `entries[${index}].notes`, min: 0, max: 500 } });
  }

  return {
    residentId: String(row.residentId),
    breakfastTime,
    lunchTime,
    dinnerTime,
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
          throw apiErr(CODES.MEAL_TIME_ENTRY_TIME_PAST_TODAY, {
            statusCode: 400,
            params: { index, field },
          });
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw apiErr(CODES.MEAL_TIME_ENTRY_TIME_INVALID, {
          statusCode: 400,
          params: { index, field },
        });
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

const listResidentsForMealTimeSchedule = async (params = {}, actorUser) => {
  if (!actorUser?._id) {
    throw apiErr(CODES.MEAL_USER_NOT_IDENTIFIED, { statusCode: 401 });
  }
  return listAssignedAdmittedResidentsForUser(actorUser._id, {
    search: params.search,
    select: '_id residentCode fullName',
  });
};

const buildTimesByResidentFromSchedule = async (scheduleDayId) => {
  assertValidObjectId(scheduleDayId, 'mealTimeScheduleDayId');
  const entries = await mealTimeScheduleEntryRepo.findByDayId(scheduleDayId);
  const byResident = {};
  for (const row of entries) {
    const rid = String(row.residentId?._id || row.residentId);
    byResident[rid] = {
      breakfast: row.breakfastTime,
      lunch: row.lunchTime,
      dinner: row.dinnerTime,
    };
  }
  return { byResident, defaultMealTimes: DEFAULT_MEAL_TIMES };
};

const assertPublishedScheduleForMealPlan = async (scheduleDayId, workDateStr, residentIds = []) => {
  assertValidObjectId(scheduleDayId, 'mealTimeScheduleDayId');
  const day = await mealTimeScheduleDayRepo.findById(scheduleDayId);
  if (!day) throw apiErr(CODES.MEAL_TIME_SCHEDULE_NOT_FOUND, { statusCode: 404 });
  if (day.status !== 'published') {
    throw apiErr(CODES.MEAL_TIME_SCHEDULE_PUBLISHED_ONLY, { statusCode: 400 });
  }
  const scheduleWorkDate = workDateToVNString(day.workDate);
  if (scheduleWorkDate !== workDateStr) {
    throw apiErr(CODES.MEAL_TIME_SCHEDULE_WORK_DATE_MISMATCH, { statusCode: 400 });
  }

  const ids = [...new Set((residentIds || []).map(String).filter(Boolean))];
  if (!ids.length) return day;

  const { byResident } = await buildTimesByResidentFromSchedule(scheduleDayId);
  const missing = ids.filter((rid) => !byResident[rid]);
  if (missing.length) {
    throw apiErr(CODES.MEAL_TIME_SCHEDULE_RESIDENTS_MISMATCH, { statusCode: 400 });
  }
  return day;
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
    throw apiErr(CODES.MEAL_PAST_DATE_NOT_ALLOWED, { statusCode: 400 });
  }

  const entriesInput = Array.isArray(body.entries) ? body.entries : [];
  if (!entriesInput.length) throw apiErr(CODES.MEAL_ENTRIES_REQUIRED, { statusCode: 400 });

  const entries = entriesInput.map((entry, index) => validateEntry(entry, index));

  const residentIds = [...new Set(entries.map((e) => e.residentId))];
  if (residentIds.length < 1) {
    throw apiErr(CODES.MEAL_TIME_SCHEDULE_NO_RESIDENTS, { statusCode: 400 });
  }
  await assertResidentsAssignedToUser(actorUserId, residentIds);
  const residentCount = await residentRepo.countAll({ _id: { $in: residentIds } });
  if (residentCount !== residentIds.length) {
    throw apiErr(CODES.MEAL_RESIDENTS_NOT_FOUND, { statusCode: 400 });
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
  return { ...apiSuccess(SUCCESS.MEAL_TIME_SCHEDULE_DRAFT_CREATED), schedule: await hydrateSchedule(saved) };
};

const updateDraft = async (id, body, actorUserId) => {
  const day = await mealTimeScheduleDayRepo.findById(id);
  if (!day) throw apiErr(CODES.MEAL_TIME_SCHEDULE_NOT_FOUND, { statusCode: 404 });
  if (day.status !== 'draft') throw apiErr(CODES.MEAL_TIME_SCHEDULE_DRAFT_ONLY_EDIT, { statusCode: 400 });

  const updatePayload = {};
  if (body.workDate !== undefined) {
    const workDate = parseWorkDateStrict(body.workDate);
    if (workDate < todayVN()) throw apiErr(CODES.MEAL_PAST_DATE_NOT_ALLOWED, { statusCode: 400 });
    updatePayload.workDate = new Date(workDate);
  }
  if (body.title !== undefined) updatePayload.title = body.title?.trim() || null;

  const hasEntries = Array.isArray(body.entries);
  const normalizedEntries = hasEntries ? body.entries.map((entry, index) => validateEntry(entry, index)) : null;
  if (hasEntries && !normalizedEntries.length) throw apiErr(CODES.MEAL_ENTRIES_EMPTY, { statusCode: 400 });

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
      if (residentIds.length < 1) {
        throw apiErr(CODES.MEAL_TIME_SCHEDULE_NO_RESIDENTS, { statusCode: 400 });
      }
      await assertResidentsAssignedToUser(actorUserId, residentIds);
      await mealTimeScheduleEntryRepo.deleteByDayId(id, dbOpts);
      await mealTimeScheduleEntryRepo.createMany(
        normalizedEntries.map((e) => ({ ...e, mealTimeScheduleDayId: id })),
        dbOpts
      );
    }
  });

  const saved = await mealTimeScheduleDayRepo.findById(id);
  return { ...apiSuccess(SUCCESS.MEAL_TIME_SCHEDULE_DRAFT_UPDATED), schedule: await hydrateSchedule(saved) };
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
  if (!day) throw apiErr(CODES.MEAL_TIME_SCHEDULE_NOT_FOUND, { statusCode: 404 });
  return hydrateSchedule(day);
};

const deleteDraft = async (id) => {
  const day = await mealTimeScheduleDayRepo.findById(id);
  if (!day) throw apiErr(CODES.MEAL_TIME_SCHEDULE_NOT_FOUND, { statusCode: 404 });
  if (day.status !== 'draft') {
    throw apiErr(CODES.MEAL_TIME_SCHEDULE_DRAFT_ONLY_DELETE, { statusCode: 400 });
  }

  const mealPlanDayRepo = require('../repositories/mealPlanDayRepository');
  const linkedPlans = await mealPlanDayRepo.countAll({ mealTimeScheduleDayId: id });
  if (linkedPlans > 0) {
    throw apiErr(CODES.MEAL_TIME_SCHEDULE_IN_USE, { statusCode: 409 });
  }

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    await mealTimeScheduleEntryRepo.deleteByDayId(id, dbOpts);
    await mealTimeScheduleDayRepo.deleteById(id, dbOpts);
  });

  return { ...apiSuccess(SUCCESS.MEAL_TIME_SCHEDULE_DRAFT_DELETED), deleted: true, id };
};

const publishSchedule = async (id, actorUserId) => {
  const day = await mealTimeScheduleDayRepo.findById(id);
  if (!day) throw apiErr(CODES.MEAL_TIME_SCHEDULE_NOT_FOUND, { statusCode: 404 });
  if (day.status === 'published') {
    return {
      ...apiSuccess(SUCCESS.MEAL_TIME_SCHEDULE_PUBLISHED),
      idempotent: true,
      schedule: await hydrateSchedule(day),
    };
  }
  if (day.status !== 'draft') {
    throw apiErr(CODES.MEAL_TIME_SCHEDULE_PUBLISH_STATUS_INVALID, {
      statusCode: 400,
      params: { status: day.status },
    });
  }

  const workDate = workDateToVNString(day.workDate);
  if (workDate < todayVN()) throw apiErr(CODES.MEAL_TIME_SCHEDULE_PUBLISH_PAST_DATE, { statusCode: 400 });

  const entries = await mealTimeScheduleEntryRepo.findByDayId(id);
  if (!entries.length) throw apiErr(CODES.MEAL_TIME_SCHEDULE_PUBLISH_EMPTY, { statusCode: 400 });
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
  if (residentIds.length < 1) {
    throw apiErr(CODES.MEAL_TIME_SCHEDULE_PUBLISH_NO_RESIDENTS, { statusCode: 400 });
  }
  await assertResidentsAssignedToUser(actorUserId, residentIds);
  await assertNoPublishedScheduleConflicts(workDate, residentIds, id);

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
  return { ...apiSuccess(SUCCESS.MEAL_TIME_SCHEDULE_PUBLISHED), schedule: await hydrateSchedule(saved) };
};

module.exports = {
  DEFAULT_MEAL_TIMES,
  getTemplates,
  listResidentsForMealTimeSchedule,
  buildTimesByResidentFromSchedule,
  assertPublishedScheduleForMealPlan,
  getPublishedTimes,
  resolveMealTimeForResident,
  createDraft,
  updateDraft,
  listSchedules,
  getSchedule,
  deleteDraft,
  publishSchedule,
};

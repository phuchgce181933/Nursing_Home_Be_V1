const mongoose = require('mongoose');
const { apiErr, apiSuccess, ApiError, CODES, SUCCESS } = require('../utils/apiError');
const mealPlanDayRepo = require('../repositories/mealPlanDayRepository');
const mealPlanEntryRepo = require('../repositories/mealPlanEntryRepository');
const mealTimeScheduleService = require('./mealTimeScheduleService');
const { getActiveDishMap } = require('./dishService');
const { listAssignedAdmittedResidentsForUser, assertResidentsAssignedToUser } = require('./assignedResidentService');
const Resident = require('../models/resident');
const { parseWorkDate, todayVN, nowVN, toMinutes, buildTaskDateTime, workDateToVNString } = require('../utils/shiftTime');
const { assertNoMealPlanConflicts } = require('../utils/mealPlanValidation');

const NON_TX_ERROR_PATTERNS = [
  /retryable writes/i,
  /replica set/i,
  /Transaction numbers are only allowed on a replica set member or mongos/i,
  /does not support transactions/i,
];

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const MEAL_STAGES = ['recovery', 'maintenance', 'special_monitoring'];
const VALID_ENTRY_SOURCES = ['template', 'manual', 'catalog'];
const DEFAULT_MEAL_TIMES = { breakfast: '07:30', lunch: '11:30', dinner: '17:30' };

const MEAL_PLAN_TEMPLATES = [
  {
    key: 'standard-balanced',
    name: 'Cân bằng tiêu chuẩn',
    description: 'Thực đơn cân đối cho cư dân có nhu cầu dinh dưỡng thông thường.',
    recommendedFor: ['maintenance'],
    totalCalories: 1300,
    entries: [
      {
        mealType: 'breakfast',
        mealName: 'Cháo yến mạch + sữa hạt',
        calories: 350,
        ingredients: ['yến mạch', 'sữa hạt'],
        nutritionNote: 'Tăng chất xơ, hỗ trợ tiêu hóa',
      },
      {
        mealType: 'lunch',
        mealName: 'Cơm mềm + cá hấp + rau luộc',
        calories: 520,
        ingredients: ['cơm mềm', 'cá hấp', 'rau luộc'],
        nutritionNote: 'Đạm dễ hấp thu, ít dầu mỡ',
      },
      {
        mealType: 'dinner',
        mealName: 'Súp gà nấm + khoai nghiền',
        calories: 430,
        ingredients: ['thịt gà', 'nấm', 'khoai tây'],
        nutritionNote: 'Bữa tối nhẹ, dễ tiêu',
      },
    ],
  },
  {
    key: 'soft-digestive',
    name: 'Mềm dễ tiêu',
    description: 'Phù hợp cư dân tiêu hóa kém hoặc đang theo dõi sau bệnh.',
    recommendedFor: ['recovery', 'special_monitoring'],
    totalCalories: 1220,
    entries: [
      {
        mealType: 'breakfast',
        mealName: 'Cháo thịt bằm',
        calories: 320,
        ingredients: ['gạo', 'thịt nạc bằm'],
        nutritionNote: 'Mềm, dễ nhai nuốt',
      },
      {
        mealType: 'lunch',
        mealName: 'Mì mềm thịt nạc + bí đỏ',
        calories: 500,
        ingredients: ['mì mềm', 'thịt nạc', 'bí đỏ'],
        nutritionNote: 'Bổ sung năng lượng vừa đủ',
      },
      {
        mealType: 'dinner',
        mealName: 'Súp rau củ + trứng hấp',
        calories: 400,
        ingredients: ['rau củ', 'trứng'],
        nutritionNote: 'Giảm áp lực tiêu hóa buổi tối',
      },
    ],
  },
];

const isNonTxErr = (err) => NON_TX_ERROR_PATTERNS.some((re) => re.test(String(err?.message || '')));

const runWithOptionalTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } catch (err) {
    if (isNonTxErr(err)) {
      console.warn('[mealPlanService] Transaction unsupported, fallback to non-transaction mode:', err.message);
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

const resolveMealTimeFromSchedule = (residentId, mealType, scheduleCache) => {
  const times = scheduleCache?.byResident?.[String(residentId)];
  if (!times?.[mealType]) {
    throw apiErr(CODES.MEAL_RESIDENT_NO_MEAL_TIME_IN_SCHEDULE, {
      statusCode: 400,
      params: { mealType },
    });
  }
  return times[mealType];
};

const validateEntry = (entry, index, mealTimeOverride, dishMap = {}) => {
  const row = entry || {};
  assertValidObjectId(row.residentId, `entries[${index}].residentId`);
  if (!MEAL_TYPES.includes(row.mealType)) {
    throw apiErr(CODES.MEAL_ENTRY_TYPE_INVALID, {
      statusCode: 400,
      params: { index, allowed: MEAL_TYPES.join(', ') },
    });
  }

  let dishId;
  let mealName = row.mealName;
  let calories = row.calories == null ? undefined : Number(row.calories);
  let ingredients = Array.isArray(row.ingredients)
    ? row.ingredients.map((v) => String(v).trim()).filter(Boolean)
    : [];
  let source = row.source || 'manual';

  if (row.dishId) {
    assertValidObjectId(row.dishId, `entries[${index}].dishId`);
    const dish = dishMap[String(row.dishId)];
    if (!dish) {
      throw apiErr(CODES.DISH_NOT_FOUND, { statusCode: 400, params: { index } });
    }
    if (!dish.isActive) {
      throw apiErr(CODES.DISH_INACTIVE, { statusCode: 400, params: { index } });
    }
    dishId = String(dish._id);
    mealName = String(mealName || dish.name).trim();
    if (calories == null || Number.isNaN(calories)) {
      calories = dish.calories;
    }
    if (!ingredients.length && Array.isArray(dish.ingredients) && dish.ingredients.length) {
      ingredients = dish.ingredients.map((v) => String(v).trim()).filter(Boolean);
    }
    source = 'catalog';
  }

  if (!mealName || !String(mealName).trim()) {
    throw apiErr(CODES.MEAL_ENTRY_NAME_REQUIRED, { statusCode: 400, params: { index } });
  }
  if (String(row.mealName).trim().length > 200) {
    throw apiErr(CODES.RESIDENT_LIST_ITEM_LENGTH_INVALID, { statusCode: 400, params: { field: `entries[${index}].mealName`, min: 0, max: 200 } });
  }
  if (row.nutritionNote && String(row.nutritionNote).trim().length > 500) {
    throw apiErr(CODES.RESIDENT_LIST_ITEM_LENGTH_INVALID, { statusCode: 400, params: { field: `entries[${index}].nutritionNote`, min: 0, max: 500 } });
  }
  if (row.stageNote && String(row.stageNote).trim().length > 500) {
    throw apiErr(CODES.RESIDENT_LIST_ITEM_LENGTH_INVALID, { statusCode: 400, params: { field: `entries[${index}].stageNote`, min: 0, max: 500 } });
  }
  if (row.calories !== undefined && row.calories !== null && row.calories !== '') {
    const cal = Number(row.calories);
    if (Number.isNaN(cal) || cal < 0 || cal > 5000) {
      throw apiErr(CODES.FIELD_INVALID_FORMAT, { statusCode: 400, params: { field: `entries[${index}].calories`, format: '0-5000' } });
    }
  }
  if (source && !VALID_ENTRY_SOURCES.includes(source)) {
    throw apiErr(CODES.MEAL_ENTRY_SOURCE_INVALID, {
      statusCode: 400,
      params: { index, allowed: VALID_ENTRY_SOURCES.join(', ') },
    });
  }
  return {
    residentId: String(row.residentId),
    mealType: row.mealType,
    dishId,
    mealName: String(mealName).trim(),
    ingredients,
    calories,
    nutritionNote: row.nutritionNote?.trim(),
    stageNote: row.stageNote?.trim(),
    source,
    templateKey: row.templateKey?.trim(),
    mealTime: row.mealTime?.trim() || mealTimeOverride || DEFAULT_MEAL_TIMES[row.mealType],
  };
};

const normalizeEntriesWithSchedule = async (entriesInput, workDateStr, mealTimeScheduleDayId) => {
  const residentIds = [...new Set(entriesInput.map((e) => String(e?.residentId || '')).filter(Boolean))];
  await mealTimeScheduleService.assertPublishedScheduleForMealPlan(
    mealTimeScheduleDayId,
    workDateStr,
    residentIds
  );
  const scheduleCache = await mealTimeScheduleService.buildTimesByResidentFromSchedule(mealTimeScheduleDayId);
  const dishMap = await getActiveDishMap(entriesInput.map((e) => e?.dishId).filter(Boolean));
  const normalized = [];
  for (const [index, raw] of entriesInput.entries()) {
    let mealTimeOverride;
    if (!raw?.mealTime?.trim()) {
      mealTimeOverride = resolveMealTimeFromSchedule(raw.residentId, raw.mealType, scheduleCache);
    }
    normalized.push(validateEntry(raw, index, mealTimeOverride, dishMap));
  }
  return normalized;
};

const resolveMealTimeScheduleDayId = (body, existingDay) => {
  const fromBody = body?.mealTimeScheduleDayId;
  if (fromBody) return String(fromBody).trim();
  const fromDay = existingDay?.mealTimeScheduleDayId?._id || existingDay?.mealTimeScheduleDayId;
  if (fromDay) return String(fromDay);
  throw apiErr(CODES.MEAL_TIME_SCHEDULE_REQUIRED, { statusCode: 400 });
};

const assertEntryMealTimesFromNow = (entries, workDateStr) => {
  if (workDateStr !== todayVN()) return;
  const now = nowVN();
  for (const [index, entry] of entries.entries()) {
    if (toMinutes(entry.mealTime) === null) {
      throw apiErr(CODES.MEAL_ENTRY_TIME_INVALID, { statusCode: 400, params: { index } });
    }
    try {
      const mealAt = buildTaskDateTime(workDateStr, entry.mealTime);
      if (mealAt < now) {
        throw apiErr(CODES.MEAL_ENTRY_TIME_PAST_TODAY, { statusCode: 400, params: { index } });
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw apiErr(CODES.MEAL_ENTRY_TIME_INVALID, { statusCode: 400, params: { index } });
    }
  }
};

const hydratePlan = async (day) => {
  if (!day) return null;
  const entries = await mealPlanEntryRepo.findByDayId(day._id);
  return { ...day.toObject(), entries };
};

const getTemplates = async () => ({
  metadata: {
    version: 'v1',
    timezone: 'Asia/Ho_Chi_Minh',
    defaultMealTimes: DEFAULT_MEAL_TIMES,
    entrySourceOptions: VALID_ENTRY_SOURCES,
  },
  careStages: MEAL_STAGES,
  mealTypes: MEAL_TYPES,
  fieldGuide: {
    required: ['residentId', 'mealType', 'mealName'],
    optional: ['ingredients', 'calories', 'nutritionNote', 'stageNote', 'source', 'templateKey', 'mealTime'],
  },
  templates: MEAL_PLAN_TEMPLATES.map((template) => ({
    ...template,
    entries: template.entries.map((entry) => ({
      ...entry,
      source: 'template',
      templateKey: template.key,
      mealTime: DEFAULT_MEAL_TIMES[entry.mealType],
      stageNote: '',
    })),
  })),
});

const listResidentsForMealPlan = async (params = {}, actorUser) => {
  if (!actorUser?._id) {
    throw apiErr(CODES.MEAL_USER_NOT_IDENTIFIED, { statusCode: 401 });
  }
  return listAssignedAdmittedResidentsForUser(actorUser._id, { search: params.search });
};

const createDraft = async (body, actorUserId) => {
  const workDate = parseWorkDateStrict(body.workDate);
  if (workDate < todayVN()) {
    throw apiErr(CODES.MEAL_PAST_DATE_NOT_ALLOWED, { statusCode: 400 });
  }
  const mealTimeScheduleDayId = resolveMealTimeScheduleDayId(body);
  const careStage = String(body.careStage || '').trim();
  if (!MEAL_STAGES.includes(careStage)) {
    throw apiErr(CODES.MEAL_CARE_STAGE_INVALID, {
      statusCode: 400,
      params: { allowed: MEAL_STAGES.join(', ') },
    });
  }
  const entriesInput = Array.isArray(body.entries) ? body.entries : [];
  if (!entriesInput.length) throw apiErr(CODES.MEAL_ENTRIES_REQUIRED, { statusCode: 400 });
  const entries = await normalizeEntriesWithSchedule(entriesInput, workDate, mealTimeScheduleDayId);
  await assertNoMealPlanConflicts({ workDate, entries });
  const residentIds = [...new Set(entries.map((e) => e.residentId))];
  if (residentIds.length < 1) {
    throw apiErr(CODES.MEAL_NO_RESIDENTS, { statusCode: 400 });
  }
  await assertResidentsAssignedToUser(actorUserId, residentIds);
  const residentCount = await Resident.countDocuments({ _id: { $in: residentIds } });
  if (residentCount !== residentIds.length) {
    throw apiErr(CODES.MEAL_RESIDENTS_NOT_FOUND, { statusCode: 400 });
  }

  let createdId;
  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    const day = await mealPlanDayRepo.create(
      {
        workDate: new Date(workDate),
        mealTimeScheduleDayId,
        careStage,
        title: body.title?.trim() || `Meal plan ${careStage} - ${workDate}`,
        status: 'draft',
        createdBy: actorUserId,
        changeLog: [{ changedBy: actorUserId, action: 'created', details: { entries: entries.length } }],
      },
      dbOpts
    );
    createdId = day._id;
    await mealPlanEntryRepo.createMany(entries.map((e) => ({ ...e, mealPlanDayId: day._id })), dbOpts);
  });
  const saved = await mealPlanDayRepo.findById(createdId);
  return { ...apiSuccess(SUCCESS.MEAL_PLAN_DRAFT_CREATED), plan: await hydratePlan(saved) };
};

const updateDraft = async (id, body, actorUserId) => {
  const day = await mealPlanDayRepo.findById(id);
  if (!day) throw apiErr(CODES.MEAL_PLAN_NOT_FOUND, { statusCode: 404 });
  if (day.status !== 'draft') throw apiErr(CODES.MEAL_PLAN_DRAFT_ONLY_EDIT, { statusCode: 400 });

  const updatePayload = {};
  if (body.workDate !== undefined) {
    const workDate = parseWorkDateStrict(body.workDate);
    if (workDate < todayVN()) throw apiErr(CODES.MEAL_PAST_DATE_NOT_ALLOWED, { statusCode: 400 });
    updatePayload.workDate = new Date(workDate);
  }
  if (body.careStage !== undefined) {
    const careStage = String(body.careStage || '').trim();
    if (!MEAL_STAGES.includes(careStage)) {
      throw apiErr(CODES.MEAL_CARE_STAGE_INVALID, {
        statusCode: 400,
        params: { allowed: MEAL_STAGES.join(', ') },
      });
    }
    updatePayload.careStage = careStage;
  }
  if (body.title !== undefined) updatePayload.title = body.title?.trim() || null;
  if (body.mealTimeScheduleDayId !== undefined) {
    assertValidObjectId(body.mealTimeScheduleDayId, 'mealTimeScheduleDayId');
    updatePayload.mealTimeScheduleDayId = body.mealTimeScheduleDayId;
  }

  const hasEntries = Array.isArray(body.entries);
  const targetWorkDateStr =
    body.workDate !== undefined
      ? parseWorkDateStrict(body.workDate)
      : workDateToVNString(day.workDate);
  const mealTimeScheduleDayId = resolveMealTimeScheduleDayId(body, day);
  const normalizedEntries = hasEntries
    ? await normalizeEntriesWithSchedule(body.entries, targetWorkDateStr, mealTimeScheduleDayId)
    : null;
  if (hasEntries && !normalizedEntries.length) throw apiErr(CODES.MEAL_ENTRIES_EMPTY, { statusCode: 400 });
  if (normalizedEntries) {
    await assertNoMealPlanConflicts({
      workDate: targetWorkDateStr,
      entries: normalizedEntries,
      excludeMealPlanDayId: id,
    });
  } else if (body.workDate !== undefined || body.mealTimeScheduleDayId !== undefined) {
    const residentIds = (await mealPlanEntryRepo.findByDayId(id)).map((e) =>
      String(e.residentId?._id || e.residentId)
    );
    await mealTimeScheduleService.assertPublishedScheduleForMealPlan(
      mealTimeScheduleDayId,
      targetWorkDateStr,
      residentIds
    );
    const existingEntries = await mealPlanEntryRepo.findByDayId(id);
    if (existingEntries.length) {
      await assertNoMealPlanConflicts({
        workDate: targetWorkDateStr,
        entries: existingEntries.map((e) => ({
          residentId: e.residentId?._id || e.residentId,
          mealType: e.mealType,
          mealTime: e.mealTime,
          mealName: e.mealName,
        })),
        excludeMealPlanDayId: id,
      });
    }
  }

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    await mealPlanDayRepo.updateById(
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
        throw apiErr(CODES.MEAL_NO_RESIDENTS, { statusCode: 400 });
      }
      await assertResidentsAssignedToUser(actorUserId, residentIds);
      await mealPlanEntryRepo.deleteByDayId(id, dbOpts);
      await mealPlanEntryRepo.createMany(normalizedEntries.map((e) => ({ ...e, mealPlanDayId: id })), dbOpts);
    }
  });
  const saved = await mealPlanDayRepo.findById(id);
  return { ...apiSuccess(SUCCESS.MEAL_PLAN_DRAFT_UPDATED), plan: await hydratePlan(saved) };
};

const listPlans = async (filter = {}, options = {}) => {
  const query = {};
  if (filter.workDate) {
    const workDate = parseWorkDateStrict(filter.workDate);
    query.workDate = {
      $gte: new Date(`${workDate}T00:00:00.000Z`),
      $lte: new Date(`${workDate}T23:59:59.999Z`),
    };
  }
  if (filter.status) query.status = filter.status;
  if (filter.careStage) query.careStage = filter.careStage;

  const page = parseInt(options.page, 10) || 1;
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    mealPlanDayRepo.findAll(query, { skip, limit }),
    mealPlanDayRepo.countAll(query),
  ]);
  const data = await Promise.all(rows.map(hydratePlan));
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const getPlan = async (id) => {
  const day = await mealPlanDayRepo.findById(id);
  if (!day) throw apiErr(CODES.MEAL_PLAN_NOT_FOUND, { statusCode: 404 });
  return hydratePlan(day);
};

const deleteDraft = async (id) => {
  const day = await mealPlanDayRepo.findById(id);
  if (!day) throw apiErr(CODES.MEAL_PLAN_NOT_FOUND, { statusCode: 404 });
  if (day.status !== 'draft') {
    throw apiErr(CODES.MEAL_PLAN_DRAFT_ONLY_DELETE, { statusCode: 400 });
  }

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    await mealPlanEntryRepo.deleteByDayId(id, dbOpts);
    await mealPlanDayRepo.deleteById(id, dbOpts);
  });

  return { ...apiSuccess(SUCCESS.MEAL_PLAN_DRAFT_DELETED), deleted: true, id };
};

const publishPlan = async (id, actorUserId) => {
  const day = await mealPlanDayRepo.findById(id);
  if (!day) throw apiErr(CODES.MEAL_PLAN_NOT_FOUND, { statusCode: 404 });
  if (day.status === 'published') {
    return {
      ...apiSuccess(SUCCESS.MEAL_PLAN_PUBLISHED),
      idempotent: true,
      plan: await hydratePlan(day),
      createdExecutionRows: 0,
    };
  }
  if (day.status !== 'draft') {
    throw apiErr(CODES.MEAL_PLAN_PUBLISH_STATUS_INVALID, {
      statusCode: 400,
      params: { status: day.status },
    });
  }
  const workDate = workDateToVNString(day.workDate);
  if (workDate < todayVN()) throw apiErr(CODES.MEAL_PLAN_PUBLISH_PAST_DATE, { statusCode: 400 });

  const entries = await mealPlanEntryRepo.findByDayId(id);
  if (!entries.length) throw apiErr(CODES.MEAL_PLAN_PUBLISH_EMPTY, { statusCode: 400 });
  assertEntryMealTimesFromNow(entries, workDate);
  const residentIds = [...new Set(entries.map((e) => String(e.residentId?._id || e.residentId)))];
  if (residentIds.length < 1) {
    throw apiErr(CODES.MEAL_PLAN_PUBLISH_NO_RESIDENTS, { statusCode: 400 });
  }
  const scheduleDayId = day.mealTimeScheduleDayId?._id || day.mealTimeScheduleDayId;
  if (!scheduleDayId) {
    throw apiErr(CODES.MEAL_TIME_SCHEDULE_REQUIRED, { statusCode: 400 });
  }
  await mealTimeScheduleService.assertPublishedScheduleForMealPlan(scheduleDayId, workDate, residentIds);
  await assertResidentsAssignedToUser(actorUserId, residentIds);
  await assertNoMealPlanConflicts({
    workDate,
    entries: entries.map((e) => ({
      residentId: e.residentId?._id || e.residentId,
      mealType: e.mealType,
      mealTime: e.mealTime,
      mealName: e.mealName,
    })),
    excludeMealPlanDayId: id,
  });

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    await mealPlanDayRepo.updateById(
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

  const saved = await mealPlanDayRepo.findById(id);
  return {
    ...apiSuccess(SUCCESS.MEAL_PLAN_PUBLISHED),
    plan: await hydratePlan(saved),
    createdExecutionRows: entries.length,
  };
};

module.exports = {
  getTemplates,
  listResidentsForMealPlan,
  createDraft,
  updateDraft,
  listPlans,
  getPlan,
  deleteDraft,
  publishPlan,
};

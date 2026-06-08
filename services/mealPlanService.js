const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const mealPlanDayRepo = require('../repositories/mealPlanDayRepository');
const mealPlanEntryRepo = require('../repositories/mealPlanEntryRepository');
const mealTimeScheduleService = require('./mealTimeScheduleService');
const Resident = require('../models/resident');
const { parseWorkDate, todayVN, nowVN, toMinutes, buildTaskDateTime, workDateToVNString } = require('../utils/shiftTime');

const NON_TX_ERROR_PATTERNS = [
  /retryable writes/i,
  /replica set/i,
  /Transaction numbers are only allowed on a replica set member or mongos/i,
  /does not support transactions/i,
];

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const MEAL_STAGES = ['recovery', 'maintenance', 'special_monitoring'];
const VALID_ENTRY_SOURCES = ['template', 'manual'];
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
    throw new ServiceError('workDate phải đúng định dạng YYYY-MM-DD', 400);
  }
  return str;
};

const assertValidObjectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
    throw new ServiceError(`${label} không hợp lệ`, 400);
  }
};

const resolveMealTimeFromPublishedSchedule = async (workDateStr, residentId, mealType, publishedCache) => {
  if (publishedCache?.byResident) {
    const times = publishedCache.byResident[String(residentId)];
    if (times?.[mealType]) return times[mealType];
    return publishedCache.defaultMealTimes?.[mealType] || DEFAULT_MEAL_TIMES[mealType];
  }
  return mealTimeScheduleService.resolveMealTimeForResident(workDateStr, residentId, mealType);
};

const validateEntry = (entry, index, mealTimeOverride) => {
  const row = entry || {};
  assertValidObjectId(row.residentId, `entries[${index}].residentId`);
  if (!MEAL_TYPES.includes(row.mealType)) {
    throw new ServiceError(`entries[${index}].mealType phải thuộc một trong: ${MEAL_TYPES.join(', ')}`, 400);
  }
  if (!row.mealName || !String(row.mealName).trim()) {
    throw new ServiceError(`entries[${index}].mealName là bắt buộc`, 400);
  }
  if (row.source && !VALID_ENTRY_SOURCES.includes(row.source)) {
    throw new ServiceError(`entries[${index}].source phải thuộc một trong: ${VALID_ENTRY_SOURCES.join(', ')}`, 400);
  }
  return {
    residentId: String(row.residentId),
    mealType: row.mealType,
    mealName: String(row.mealName).trim(),
    ingredients: Array.isArray(row.ingredients) ? row.ingredients.map((v) => String(v).trim()).filter(Boolean) : [],
    calories: row.calories == null ? undefined : Number(row.calories),
    nutritionNote: row.nutritionNote?.trim(),
    stageNote: row.stageNote?.trim(),
    source: row.source || 'manual',
    templateKey: row.templateKey?.trim(),
    mealTime: row.mealTime?.trim() || mealTimeOverride || DEFAULT_MEAL_TIMES[row.mealType],
  };
};

const normalizeEntriesWithPublishedSchedule = async (entriesInput, workDateStr) => {
  const publishedCache = await mealTimeScheduleService.getPublishedTimes(workDateStr);
  const normalized = [];
  for (const [index, raw] of entriesInput.entries()) {
    let mealTimeOverride;
    if (!raw?.mealTime?.trim()) {
      mealTimeOverride = await resolveMealTimeFromPublishedSchedule(
        workDateStr,
        raw.residentId,
        raw.mealType,
        publishedCache
      );
    }
    normalized.push(validateEntry(raw, index, mealTimeOverride));
  }
  return normalized;
};

const assertEntryMealTimesFromNow = (entries, workDateStr) => {
  if (workDateStr !== todayVN()) return;
  const now = nowVN();
  for (const [index, entry] of entries.entries()) {
    if (toMinutes(entry.mealTime) === null) {
      throw new ServiceError(`entries[${index}].mealTime phải đúng định dạng HH:mm`, 400);
    }
    try {
      const mealAt = buildTaskDateTime(workDateStr, entry.mealTime);
      if (mealAt < now) {
        throw new ServiceError(`entries[${index}].mealTime phải từ thời điểm hiện tại trở đi cho ngày hôm nay`, 400);
      }
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError(`entries[${index}].mealTime phải đúng định dạng HH:mm`, 400);
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

const listResidentsForMealPlan = async (params = {}) => {
  const query = { residencyStatus: params.status || 'admitted' };
  const search = String(params.search || '').trim();
  if (search) {
    query.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { residentCode: { $regex: search, $options: 'i' } },
    ];
  }
  const residents = await Resident.find(query)
    .select('_id residentCode fullName allergies chronicConditions')
    .sort({ fullName: 1 })
    .limit(500)
    .lean();
  return { data: residents };
};

const createDraft = async (body, actorUserId) => {
  const workDate = parseWorkDateStrict(body.workDate);
  if (workDate < todayVN()) {
    throw new ServiceError('Không thể tạo meal plan cho ngày trong quá khứ', 400);
  }
  const careStage = String(body.careStage || '').trim();
  if (!MEAL_STAGES.includes(careStage)) {
    throw new ServiceError(`careStage phải thuộc một trong: ${MEAL_STAGES.join(', ')}`, 400);
  }
  const entriesInput = Array.isArray(body.entries) ? body.entries : [];
  if (!entriesInput.length) throw new ServiceError('entries là bắt buộc và không được để trống', 400);
  const entries = await normalizeEntriesWithPublishedSchedule(entriesInput, workDate);
  assertEntryMealTimesFromNow(entries, workDate);
  const residentIds = [...new Set(entries.map((e) => e.residentId))];
  if (residentIds.length < 2) {
    throw new ServiceError('Meal plan phải có ít nhất 2 cư dân', 400);
  }
  const residentCount = await Resident.countDocuments({ _id: { $in: residentIds } });
  if (residentCount !== residentIds.length) {
    throw new ServiceError('Có cư dân trong danh sách entries không tồn tại', 400);
  }

  let createdId;
  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    const day = await mealPlanDayRepo.create(
      {
        workDate: new Date(workDate),
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
  return { message: 'Tạo meal plan nháp thành công', plan: await hydratePlan(saved) };
};

const updateDraft = async (id, body, actorUserId) => {
  const day = await mealPlanDayRepo.findById(id);
  if (!day) throw new ServiceError('Không tìm thấy meal plan', 404);
  if (day.status !== 'draft') throw new ServiceError('Chỉ có thể cập nhật meal plan ở trạng thái nháp', 400);

  const updatePayload = {};
  if (body.workDate !== undefined) {
    const workDate = parseWorkDateStrict(body.workDate);
    if (workDate < todayVN()) throw new ServiceError('Không thể cập nhật meal plan về ngày quá khứ', 400);
    updatePayload.workDate = new Date(workDate);
  }
  if (body.careStage !== undefined) {
    const careStage = String(body.careStage || '').trim();
    if (!MEAL_STAGES.includes(careStage)) {
      throw new ServiceError(`careStage phải thuộc một trong: ${MEAL_STAGES.join(', ')}`, 400);
    }
    updatePayload.careStage = careStage;
  }
  if (body.title !== undefined) updatePayload.title = body.title?.trim() || null;

  const hasEntries = Array.isArray(body.entries);
  const targetWorkDateStr =
    body.workDate !== undefined
      ? parseWorkDateStrict(body.workDate)
      : workDateToVNString(day.workDate);
  const normalizedEntries = hasEntries
    ? await normalizeEntriesWithPublishedSchedule(body.entries, targetWorkDateStr)
    : null;
  if (hasEntries && !normalizedEntries.length) throw new ServiceError('entries không được để trống', 400);
  if (normalizedEntries) {
    assertEntryMealTimesFromNow(normalizedEntries, targetWorkDateStr);
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
      if (residentIds.length < 2) {
        throw new ServiceError('Meal plan phải có ít nhất 2 cư dân', 400);
      }
      await mealPlanEntryRepo.deleteByDayId(id, dbOpts);
      await mealPlanEntryRepo.createMany(normalizedEntries.map((e) => ({ ...e, mealPlanDayId: id })), dbOpts);
    }
  });
  const saved = await mealPlanDayRepo.findById(id);
  return { message: 'Cập nhật meal plan nháp thành công', plan: await hydratePlan(saved) };
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
  if (!day) throw new ServiceError('Không tìm thấy meal plan', 404);
  return hydratePlan(day);
};

const deleteDraft = async (id) => {
  const day = await mealPlanDayRepo.findById(id);
  if (!day) throw new ServiceError('Không tìm thấy meal plan', 404);
  if (day.status !== 'draft') {
    throw new ServiceError('Chỉ có thể xóa meal plan ở trạng thái nháp', 400);
  }

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    await mealPlanEntryRepo.deleteByDayId(id, dbOpts);
    await mealPlanDayRepo.deleteById(id, dbOpts);
  });

  return { message: 'Xóa meal plan nháp thành công', deleted: true, id };
};

const publishPlan = async (id, actorUserId) => {
  const day = await mealPlanDayRepo.findById(id);
  if (!day) throw new ServiceError('Không tìm thấy meal plan', 404);
  if (day.status === 'published') {
    return { message: 'Meal plan đã publish trước đó', idempotent: true, plan: await hydratePlan(day), createdExecutionRows: 0 };
  }
  if (day.status !== 'draft') throw new ServiceError(`Không thể publish meal plan ở trạng thái ${day.status}`, 400);
  const workDate = workDateToVNString(day.workDate);
  if (workDate < todayVN()) throw new ServiceError('Không thể publish meal plan cho ngày trong quá khứ', 400);

  const entries = await mealPlanEntryRepo.findByDayId(id);
  if (!entries.length) throw new ServiceError('Không thể publish meal plan rỗng', 400);
  assertEntryMealTimesFromNow(entries, workDate);
  const residentIds = [...new Set(entries.map((e) => String(e.residentId?._id || e.residentId)))];
  if (residentIds.length < 2) throw new ServiceError('Meal plan phải có ít nhất 2 cư dân trước khi publish', 400);

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
    message: 'Publish meal plan thành công',
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


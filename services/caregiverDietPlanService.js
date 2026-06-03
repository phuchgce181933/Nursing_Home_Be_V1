const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const MealPlanDay = require('../models/mealPlanDay');
const MealPlanEntry = require('../models/mealPlanEntry');
const SpecialDietDay = require('../models/specialDietDay');
const SpecialDietEntry = require('../models/specialDietEntry');
const assignedResidentService = require('./assignedResidentService');
const mealTimeScheduleService = require('./mealTimeScheduleService');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const { parseWorkDate } = require('../utils/shiftTime');

const MEAL_ORDER = ['breakfast', 'lunch', 'dinner'];

const workDateRangeFilter = (workDateStr) => ({
  $gte: new Date(`${workDateStr}T00:00:00.000Z`),
  $lte: new Date(`${workDateStr}T23:59:59.999Z`),
});

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

const getCaregiverProfile = async (userId) => {
  const profile = await staffProfileRepo.findByUserId(userId);
  if (!profile) {
    throw new ServiceError('Không tìm thấy hồ sơ nhân viên. Vui lòng liên hệ quản trị.', 400);
  }
  return profile;
};

const assertResidentAssigned = async (profile, residentId) => {
  const assigned = (profile.assignedResidentIds || []).map((r) => String(r._id || r));
  if (!assigned.includes(String(residentId))) {
    throw new ServiceError('Cư dân không thuộc danh sách phụ trách của bạn', 403);
  }
};

const findLatestPublishedDay = async (Model, workDateStr) =>
  Model.findOne({
    status: 'published',
    workDate: workDateRangeFilter(workDateStr),
  })
    .sort({ publishedAt: -1 })
    .lean();

const sortMeals = (entries) =>
  [...entries].sort((a, b) => MEAL_ORDER.indexOf(a.mealType) - MEAL_ORDER.indexOf(b.mealType));

const loadPublishedMealsForResident = async (residentId, workDateStr, mealTimesByResident) => {
  const day = await findLatestPublishedDay(MealPlanDay, workDateStr);
  if (!day) {
    return { published: false, planTitle: null, careStage: null, meals: [] };
  }

  const entries = await MealPlanEntry.find({
    mealPlanDayId: day._id,
    residentId,
  }).lean();

  const times = mealTimesByResident[String(residentId)] || {};
  const meals = sortMeals(entries).map((entry) => ({
    mealType: entry.mealType,
    mealName: entry.mealName,
    mealTime: entry.mealTime || times[entry.mealType] || null,
    calories: entry.calories,
    ingredients: entry.ingredients || [],
    nutritionNote: entry.nutritionNote,
    stageNote: entry.stageNote,
  }));

  return {
    published: meals.length > 0,
    planTitle: day.title || null,
    careStage: day.careStage || null,
    publishedAt: day.publishedAt,
    meals,
  };
};

const loadPublishedSpecialDietsForResident = async (residentId, workDateStr) => {
  const day = await findLatestPublishedDay(SpecialDietDay, workDateStr);
  if (!day) {
    return { published: false, planTitle: null, entries: [] };
  }

  const entries = await SpecialDietEntry.find({
    specialDietDayId: day._id,
    residentId,
  }).lean();

  return {
    published: entries.length > 0,
    planTitle: day.title || null,
    publishedAt: day.publishedAt,
    entries: entries.map((entry) => ({
      dietType: entry.dietType,
      restrictions: entry.restrictions || [],
      nutritionGoal: entry.nutritionGoal,
      notes: entry.notes,
      effectiveTime: entry.effectiveTime,
    })),
  };
};

const listAssignedResidents = async (userId) =>
  assignedResidentService.listAssignedResidentsForUser(userId, { fields: 'minimal' });

const listDietPlansOverview = async (userId, query) => {
  if (!query.workDate) {
    throw new ServiceError('workDate là bắt buộc (YYYY-MM-DD)', 400);
  }
  const workDate = parseWorkDateStrict(query.workDate);
  const profile = await getCaregiverProfile(userId);
  const { data: residentList } = await assignedResidentService.listAssignedResidentsForUser(userId, {
    search: query.search,
  });
  let rows = residentList || [];

  if (query.residentId) {
    assertValidObjectId(query.residentId, 'residentId');
    await assertResidentAssigned(profile, query.residentId);
    rows = rows.filter((r) => String(r._id) === String(query.residentId));
  }

  const residentIds = rows.map((r) => String(r._id));
  const mealTimesMap = await mealTimeScheduleService.getPublishedTimes(workDate, residentIds);

  const [mealPlanDay, specialDietDay] = await Promise.all([
    findLatestPublishedDay(MealPlanDay, workDate),
    findLatestPublishedDay(SpecialDietDay, workDate),
  ]);

  let mealCountsByResident = new Map();
  let dietCountsByResident = new Map();

  if (mealPlanDay && residentIds.length) {
    const mealEntries = await MealPlanEntry.find({
      mealPlanDayId: mealPlanDay._id,
      residentId: { $in: residentIds },
    })
      .select('residentId mealType')
      .lean();
    for (const entry of mealEntries) {
      const rid = String(entry.residentId);
      mealCountsByResident.set(rid, (mealCountsByResident.get(rid) || 0) + 1);
    }
  }

  if (specialDietDay && residentIds.length) {
    const dietEntries = await SpecialDietEntry.find({
      specialDietDayId: specialDietDay._id,
      residentId: { $in: residentIds },
    })
      .select('residentId')
      .lean();
    for (const entry of dietEntries) {
      const rid = String(entry.residentId);
      dietCountsByResident.set(rid, (dietCountsByResident.get(rid) || 0) + 1);
    }
  }

  const data = rows.map((r) => {
    const rid = String(r._id);
    const mealCount = mealCountsByResident.get(rid) || 0;
    const dietCount = dietCountsByResident.get(rid) || 0;
    return {
      residentId: rid,
      fullName: r.fullName,
      residentCode: r.residentCode,
      allergies: r.allergies || [],
      chronicConditions: r.chronicConditions || [],
      hasMealPlan: mealCount > 0,
      hasSpecialDiet: dietCount > 0,
      mealPlanMealCount: mealCount,
      specialDietCount: dietCount,
      hasMealTimeSchedule: Boolean(mealTimesMap.byResident?.[rid]),
    };
  });

  return {
    workDate,
    hasPublishedMealPlanDay: Boolean(mealPlanDay),
    hasPublishedSpecialDietDay: Boolean(specialDietDay),
    mealPlanDayTitle: mealPlanDay?.title || null,
    specialDietDayTitle: specialDietDay?.title || null,
    data,
    total: data.length,
  };
};

const getResidentDietPlan = async (userId, residentId, query) => {
  assertValidObjectId(residentId, 'residentId');
  if (!query.workDate) {
    throw new ServiceError('workDate là bắt buộc (YYYY-MM-DD)', 400);
  }
  const workDate = parseWorkDateStrict(query.workDate);
  const profile = await getCaregiverProfile(userId);
  await assertResidentAssigned(profile, residentId);

  const resident = await assignedResidentService.getAssignedResidentById(userId, residentId);

  const mealTimesMap = await mealTimeScheduleService.getPublishedTimes(workDate, [String(residentId)]);
  const byResident = mealTimesMap.byResident || {};
  const residentTimes = byResident[String(residentId)] || mealTimesMap.defaultMealTimes || {};

  const [mealPlan, specialDiets] = await Promise.all([
    loadPublishedMealsForResident(residentId, workDate, byResident),
    loadPublishedSpecialDietsForResident(residentId, workDate),
  ]);

  return {
    workDate,
    resident: {
      residentId: String(resident._id),
      fullName: resident.fullName,
      residentCode: resident.residentCode,
      allergies: resident.allergies || [],
      drugAllergies: resident.drugAllergies || [],
      chronicConditions: resident.chronicConditions || [],
    },
    mealPlan,
    specialDiets,
    mealTimes: {
      breakfast: residentTimes.breakfast || mealTimesMap.defaultMealTimes?.breakfast,
      lunch: residentTimes.lunch || mealTimesMap.defaultMealTimes?.lunch,
      dinner: residentTimes.dinner || mealTimesMap.defaultMealTimes?.dinner,
      source: mealTimesMap.source,
    },
  };
};

module.exports = {
  listAssignedResidents,
  listDietPlansOverview,
  getResidentDietPlan,
};

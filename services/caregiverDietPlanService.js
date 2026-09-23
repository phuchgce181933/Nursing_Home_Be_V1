const mongoose = require('mongoose');
const { apiErr, CODES } = require('../utils/apiError');
const specialDietEntryRepo = require('../repositories/specialDietEntryRepository');
const specialDietDayRepo = require('../repositories/specialDietDayRepository');
const assignedResidentService = require('./assignedResidentService');
const mealTimeScheduleService = require('./mealTimeScheduleService');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const {
  findPublishedMealsForResident,
  countPublishedMealsByResidents,
  hasAnyPublishedMealPlanDay,
} = require('../utils/publishedMealPlanLookup');
const { parseWorkDate } = require('../utils/shiftTime');

const MEAL_ORDER = ['breakfast', 'lunch', 'dinner'];

const parseWorkDateStrict = (workDate) => {
  const str = String(workDate || '').trim();
  try {
    parseWorkDate(str);
  } catch {
    throw apiErr(CODES.WORK_DATE_INVALID_FORMAT, { statusCode: 400 });
  }
  return str;
};

const assertValidObjectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
    throw apiErr(CODES.CAREGIVER_INVALID_OBJECT_ID, { statusCode: 400, params: { label } });
  }
};

const getCaregiverProfile = async (userId) => {
  const profile = await staffProfileRepo.findByUserId(userId);
  if (!profile) {
    throw apiErr(CODES.CAREGIVER_STAFF_PROFILE_NOT_FOUND, { statusCode: 400 });
  }
  return profile;
};

const assertResidentAssigned = async (profile, residentId) => {
  const assigned = (profile.assignedResidentIds || []).map((r) => String(r._id || r));
  if (!assigned.includes(String(residentId))) {
    throw apiErr(CODES.CAREGIVER_RESIDENT_NOT_ASSIGNED, { statusCode: 403 });
  }
};

const sortMeals = (entries) =>
  [...entries].sort((a, b) => MEAL_ORDER.indexOf(a.mealType) - MEAL_ORDER.indexOf(b.mealType));

const loadPublishedMealsForResident = async (residentId, workDateStr, mealTimesByResident) => {
  const { entries, day } = await findPublishedMealsForResident(residentId, workDateStr);
  if (!day) {
    return { published: false, planTitle: null, careStage: null, meals: [] };
  }

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
  const day = await specialDietDayRepo.findPublishedByWorkDate(workDateStr);
  if (!day) {
    return { published: false, planTitle: null, entries: [] };
  }

  const entries = await specialDietEntryRepo.findByFilterLean({
    specialDietDayId: day._id,
    residentId,
  });

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
    throw apiErr(CODES.WORK_DATE_REQUIRED, { statusCode: 400 });
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

  const [hasPublishedMealPlanDay, specialDietDay, mealCountsByResident] = await Promise.all([
    hasAnyPublishedMealPlanDay(workDate),
    specialDietDayRepo.findPublishedByWorkDate(workDate),
    countPublishedMealsByResidents(residentIds, workDate),
  ]);

  let dietCountsByResident = new Map();

  if (specialDietDay && residentIds.length) {
    const dietEntries = await specialDietEntryRepo.findByFilterLean(
      { specialDietDayId: specialDietDay._id, residentId: { $in: residentIds } },
      { select: 'residentId' }
    );
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
    hasPublishedMealPlanDay,
    hasPublishedSpecialDietDay: Boolean(specialDietDay),
    mealPlanDayTitle: null,
    specialDietDayTitle: specialDietDay?.title || null,
    data,
    total: data.length,
  };
};

const getResidentDietPlan = async (userId, residentId, query) => {
  assertValidObjectId(residentId, 'residentId');
  if (!query.workDate) {
    throw apiErr(CODES.WORK_DATE_REQUIRED, { statusCode: 400 });
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

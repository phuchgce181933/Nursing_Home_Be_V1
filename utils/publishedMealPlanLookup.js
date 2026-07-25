const MealPlanDay = require('../models/mealPlanDay');
const MealPlanEntry = require('../models/mealPlanEntry');

const workDateRangeFilter = (workDateStr) => ({
  $gte: new Date(`${workDateStr}T00:00:00.000Z`),
  $lte: new Date(`${workDateStr}T23:59:59.999Z`),
});

const findPublishedDaysByWorkDate = async (workDateStr) =>
  MealPlanDay.find({
    status: 'published',
    workDate: workDateRangeFilter(workDateStr),
  })
    .sort({ publishedAt: -1 })
    .lean();

const findPublishedMealPlanEntryForResident = async (residentId, workDateStr, mealType) => {
  const days = await findPublishedDaysByWorkDate(workDateStr);
  for (const day of days) {
    const entry = await MealPlanEntry.findOne({
      mealPlanDayId: day._id,
      residentId,
      mealType,
    }).lean();
    if (entry) {
      return { entry, day };
    }
  }
  return { entry: null, day: null };
};

const findPublishedMealsForResident = async (residentId, workDateStr) => {
  const days = await findPublishedDaysByWorkDate(workDateStr);
  for (const day of days) {
    const entries = await MealPlanEntry.find({
      mealPlanDayId: day._id,
      residentId,
    }).lean();
    if (entries.length > 0) {
      return { entries, day };
    }
  }
  return { entries: [], day: null };
};

const countPublishedMealsByResidents = async (residentIds, workDateStr) => {
  const counts = new Map();
  if (!residentIds.length) return counts;

  const days = await findPublishedDaysByWorkDate(workDateStr);
  const unfound = new Set(residentIds.map(String));

  for (const day of days) {
    if (unfound.size === 0) break;
    const entries = await MealPlanEntry.find({
      mealPlanDayId: day._id,
      residentId: { $in: [...unfound] },
    })
      .select('residentId mealType')
      .lean();

    const foundInDay = new Set();
    for (const entry of entries) {
      const rid = String(entry.residentId);
      if (!counts.has(rid)) {
        counts.set(rid, 0);
        foundInDay.add(rid);
      }
      counts.set(rid, (counts.get(rid) || 0) + 1);
    }
    for (const rid of foundInDay) {
      unfound.delete(rid);
    }
  }

  return counts;
};

const hasAnyPublishedMealPlanDay = async (workDateStr) => {
  const day = await MealPlanDay.findOne({
    status: 'published',
    workDate: workDateRangeFilter(workDateStr),
  })
    .select('_id')
    .lean();
  return Boolean(day);
};

module.exports = {
  workDateRangeFilter,
  findPublishedDaysByWorkDate,
  findPublishedMealPlanEntryForResident,
  findPublishedMealsForResident,
  countPublishedMealsByResidents,
  hasAnyPublishedMealPlanDay,
};

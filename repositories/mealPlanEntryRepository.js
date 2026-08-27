const MealPlanEntry = require('../models/mealPlanEntry');
const MealPlanDay = require('../models/mealPlanDay');

const POPULATE = [{ path: 'residentId', select: 'fullName residentCode allergies chronicConditions' }];

const workDateRangeFilter = (workDateStr) => ({
  $gte: new Date(`${workDateStr}T00:00:00.000Z`),
  $lte: new Date(`${workDateStr}T23:59:59.999Z`),
});

const findByResidentsOnWorkDate = async (residentIds, workDateStr, { excludeMealPlanDayId } = {}) => {
  const ids = [...new Set((residentIds || []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return [];

  const dayFilter = {
    workDate: workDateRangeFilter(workDateStr),
    status: { $in: ['draft', 'published'] },
  };
  if (excludeMealPlanDayId) {
    dayFilter._id = { $ne: excludeMealPlanDayId };
  }

  const days = await MealPlanDay.find(dayFilter).select('_id title status').lean();
  if (!days.length) return [];

  const dayMap = Object.fromEntries(days.map((d) => [String(d._id), d]));
  const entries = await MealPlanEntry.find({
    mealPlanDayId: { $in: days.map((d) => d._id) },
    residentId: { $in: ids },
  })
    .populate(POPULATE)
    .lean();

  return entries.map((entry) => {
    const plan = dayMap[String(entry.mealPlanDayId)] || {};
    return {
      ...entry,
      planId: plan._id,
      planTitle: plan.title,
      planStatus: plan.status,
    };
  });
};

const createMany = async (rows, options = {}) => MealPlanEntry.insertMany(rows, options);

const findByDayId = async (mealPlanDayId) =>
  MealPlanEntry.find({ mealPlanDayId }).populate(POPULATE).sort({ mealType: 1, createdAt: 1 });

const deleteByDayId = async (mealPlanDayId, options = {}) =>
  MealPlanEntry.deleteMany({ mealPlanDayId }, options);

const findOneLean = async (filter) => MealPlanEntry.findOne(filter).lean();

const findByFilterLean = async (filter, { select } = {}) => {
  let q = MealPlanEntry.find(filter);
  if (select) q = q.select(select);
  return q.lean();
};

const exists = async (filter) => MealPlanEntry.exists(filter);

module.exports = { createMany, findByDayId, deleteByDayId, findByResidentsOnWorkDate, findOneLean, findByFilterLean, exists };


const MealPlanEntry = require('../models/mealPlanEntry');

const POPULATE = [{ path: 'residentId', select: 'fullName residentCode allergies chronicConditions' }];

const createMany = async (rows, options = {}) => MealPlanEntry.insertMany(rows, options);

const findByDayId = async (mealPlanDayId) =>
  MealPlanEntry.find({ mealPlanDayId }).populate(POPULATE).sort({ mealType: 1, createdAt: 1 });

const deleteByDayId = async (mealPlanDayId, options = {}) =>
  MealPlanEntry.deleteMany({ mealPlanDayId }, options);

module.exports = { createMany, findByDayId, deleteByDayId };


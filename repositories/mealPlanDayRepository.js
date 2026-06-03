const MealPlanDay = require('../models/mealPlanDay');

const create = async (data, options = {}) => MealPlanDay.create([data], options).then((rows) => rows[0]);

const findById = async (id) =>
  MealPlanDay.findById(id)
    .populate({ path: 'createdBy', select: 'fullName role' })
    .populate({ path: 'publishedBy', select: 'fullName role' });

const findAll = async (filter, { skip = 0, limit = 20, sort = { workDate: 1, createdAt: -1 } } = {}) =>
  MealPlanDay.find(filter).sort(sort).skip(skip).limit(limit);

const countAll = async (filter) => MealPlanDay.countDocuments(filter);

const updateById = async (id, data, options = {}) =>
  MealPlanDay.findByIdAndUpdate(id, data, { new: true, runValidators: true, ...options });

const deleteById = async (id, options = {}) => MealPlanDay.findByIdAndDelete(id, options);

module.exports = { create, findById, findAll, countAll, updateById, deleteById };


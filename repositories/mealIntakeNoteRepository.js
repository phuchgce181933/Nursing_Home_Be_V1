const MealIntakeNote = require('../models/mealIntakeNote');

const POPULATE = [
  { path: 'residentId', select: 'fullName residentCode residencyStatus' },
  {
    path: 'recordedByStaffId',
    select: 'staffCode',
    populate: { path: 'userId', select: 'fullName role' },
  },
];

const create = async (data) => MealIntakeNote.create(data);

const findById = async (id) => MealIntakeNote.findById(id).populate(POPULATE);

const findOneByUnique = async (residentId, workDate, mealType) =>
  MealIntakeNote.findOne({ residentId, workDate, mealType });

const findAll = async (filter, { skip = 0, limit = 50, sort = { recordedAt: -1 } } = {}) =>
  MealIntakeNote.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit);

const countAll = async (filter) => MealIntakeNote.countDocuments(filter);

const findInWorkDateRange = async (fromStr, toStr, extraFilter = {}) =>
  MealIntakeNote.find({
    ...extraFilter,
    workDate: {
      $gte: new Date(`${fromStr}T00:00:00.000Z`),
      $lte: new Date(`${toStr}T23:59:59.999Z`),
    },
  })
    .populate(POPULATE)
    .sort({ workDate: -1, recordedAt: -1 })
    .lean();

const updateById = async (id, data) =>
  MealIntakeNote.findByIdAndUpdate(id, data, { new: true, runValidators: true }).populate(POPULATE);

const deleteById = async (id) => MealIntakeNote.findByIdAndDelete(id);

module.exports = {
  create,
  findById,
  findOneByUnique,
  findAll,
  countAll,
  findInWorkDateRange,
  updateById,
  deleteById,
};

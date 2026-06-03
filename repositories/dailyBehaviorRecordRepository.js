const DailyBehaviorRecord = require('../models/dailyBehaviorRecord');

const POPULATE = [
  { path: 'residentId', select: 'fullName residentCode residencyStatus roomId', populate: { path: 'roomId', select: 'roomNumber' } },
  {
    path: 'recordedByStaffId',
    select: 'staffCode',
    populate: { path: 'userId', select: 'fullName role' },
  },
];

const create = async (data) => DailyBehaviorRecord.create(data);

const findById = async (id) => DailyBehaviorRecord.findById(id).populate(POPULATE);

const findAll = async (filter, { skip = 0, limit = 50, sort = { observedAt: -1 } } = {}) =>
  DailyBehaviorRecord.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit);

const countAll = async (filter) => DailyBehaviorRecord.countDocuments(filter);

const updateById = async (id, data) =>
  DailyBehaviorRecord.findByIdAndUpdate(id, data, { new: true, runValidators: true }).populate(POPULATE);

const deleteById = async (id) => DailyBehaviorRecord.findByIdAndDelete(id);

module.exports = {
  create,
  findById,
  findAll,
  countAll,
  updateById,
  deleteById,
};

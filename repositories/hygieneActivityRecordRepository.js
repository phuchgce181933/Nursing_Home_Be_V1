const HygieneActivityRecord = require('../models/hygieneActivityRecord');

const POPULATE = [
  { path: 'residentId', select: 'fullName residentCode residencyStatus roomId', populate: { path: 'roomId', select: 'roomNumber' } },
  {
    path: 'recordedByStaffId',
    select: 'staffCode',
    populate: { path: 'userId', select: 'fullName role' },
  },
];

const create = async (data) => HygieneActivityRecord.create(data);

const findById = async (id) => HygieneActivityRecord.findById(id).populate(POPULATE);

const findOneByUnique = async (residentId, workDate, activityType) =>
  HygieneActivityRecord.findOne({ residentId, workDate, activityType }).populate(POPULATE);

const findAll = async (filter, { skip = 0, limit = 50, sort = { recordedAt: -1 } } = {}) =>
  HygieneActivityRecord.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit);

const countAll = async (filter) => HygieneActivityRecord.countDocuments(filter);

const updateById = async (id, data) =>
  HygieneActivityRecord.findByIdAndUpdate(id, data, { new: true, runValidators: true }).populate(POPULATE);

const deleteById = async (id) => HygieneActivityRecord.findByIdAndDelete(id);

module.exports = {
  create,
  findById,
  findOneByUnique,
  findAll,
  countAll,
  updateById,
  deleteById,
};

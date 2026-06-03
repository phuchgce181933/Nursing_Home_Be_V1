const Medication = require('../models/medication');

const create = (data) => Medication.create(data);

const findById = (id) => Medication.findById(id);

const findByIds = (ids) => Medication.find({ _id: { $in: ids } });

const findByCode = (code) => Medication.findOne({ medicationCode: code });

const findAll = (filter, { sort, skip, limit } = {}) =>
  Medication.find(filter).sort(sort).skip(skip).limit(limit);

const countAll = (filter) => Medication.countDocuments(filter);

const updateById = (id, data) => Medication.findByIdAndUpdate(id, data, { new: true, runValidators: true });

module.exports = {
  create,
  findById,
  findByIds,
  findByCode,
  findAll,
  countAll,
  updateById,
};

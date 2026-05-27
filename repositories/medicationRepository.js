const Medication = require('../models/medication');

const create = (data) => Medication.create(data);

const findById = (id) => Medication.findById(id);

const findByCode = (medicationCode) =>
  Medication.findOne({ medicationCode: medicationCode.toUpperCase().trim() });

const findByName = (name, excludeId = null) => {
  const filter = { name: { $regex: `^${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}$`, $options: 'i' } };
  if (excludeId) filter._id = { $ne: excludeId };
  return Medication.findOne(filter);
};

const findAll = (filter, { sort, skip, limit }) =>
  Medication.find(filter).sort(sort).skip(skip).limit(limit);

const findByIds = (ids) => Medication.find({ _id: { $in: ids } });

const countAll = (filter) => Medication.countDocuments(filter);

const updateById = (id, data) =>
  Medication.findByIdAndUpdate(id, data, { new: true, runValidators: true });

module.exports = {
  create,
  findById,
  findByCode,
  findByName,
  findAll,
  findByIds,
  countAll,
  updateById,
};

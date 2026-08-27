const MedicalCharge = require('../models/medicalCharge');

const create = (data) => MedicalCharge.create(data);

const findById = (id) => MedicalCharge.findById(id);

const findAll = (filter, { sort, skip, limit } = {}) =>
  MedicalCharge.find(filter).sort(sort).skip(skip).limit(limit).lean();

const countAll = (filter) => MedicalCharge.countDocuments(filter);

const updateById = (id, data) =>
  MedicalCharge.findByIdAndUpdate(id, data, { new: true, runValidators: true });

const saveDoc = (doc) => doc.save();

const updateMany = (filter, update) => MedicalCharge.updateMany(filter, update);

module.exports = {
  create,
  findById,
  findAll,
  countAll,
  updateById,
  saveDoc,
  updateMany,
};

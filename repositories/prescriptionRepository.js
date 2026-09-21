const Prescription = require('../models/prescription');

const create = (data) => Prescription.create(data);

const findById = (id) => Prescription.findById(id);

const findByIdPopulated = (id) =>
  Prescription.findById(id)
    .populate('residentId', 'fullName dateOfBirth chronicConditions allergies')
    .populate('doctorId', 'fullName')
    .populate('items.medicationId', 'name medicationCode form strength unit description')
    .populate('acknowledgments.acknowledgedBy', 'fullName role')
    .populate('editHistory.editedBy', 'fullName role');

const findByIdListPopulated = (id) =>
  Prescription.findById(id)
    .populate('residentId', 'fullName dateOfBirth')
    .populate('doctorId', 'fullName')
    .populate('items.medicationId', 'name medicationCode form strength unit')
    .populate('editHistory.editedBy', 'fullName role');

const findAll = (filter, { sort, skip, limit } = {}) =>
  Prescription.find(filter)
    .populate('residentId', 'fullName dateOfBirth')
    .populate('doctorId', 'fullName')
    .populate('items.medicationId', 'name medicationCode form strength unit')
    .sort(sort)
    .skip(skip)
    .limit(limit);

const findByIdWithResident = (id) =>
  Prescription.findById(id).populate('residentId');

const findByIdLean = (id) => Prescription.findById(id).lean();

const findByFilter = (filter, { select } = {}) => {
  let q = Prescription.find(filter);
  if (select) q = q.select(select);
  return q;
};

const countAll = (filter) => Prescription.countDocuments(filter);

const saveDoc = (doc) => doc.save();

module.exports = {
  create,
  findById,
  findByIdPopulated,
  findByIdListPopulated,
  findAll,
  findByFilter,
  countAll,
  findByIdWithResident,
  findByIdLean,
  saveDoc,
};

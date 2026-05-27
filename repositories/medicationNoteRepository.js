const MedicationNote = require('../models/medicationNote');

const create = (data) => MedicationNote.create(data);

const findByMedicationId = (medicationId, { sort, skip, limit }) =>
  MedicationNote.find({ medicationId })
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate('createdBy', 'fullName email');

const countByMedicationId = (medicationId) => MedicationNote.countDocuments({ medicationId });

module.exports = {
  create,
  findByMedicationId,
  countByMedicationId,
};

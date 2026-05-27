const MedicationDispense = require('../models/medicationDispense');

const create = (data) => MedicationDispense.create(data);

const findAll = (filter, { sort, skip, limit }) =>
  MedicationDispense.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate('medicationId', 'name medicationCode unit')
    .populate('dispensedByUserId', 'fullName email')
    .populate('residentId', 'fullName residentCode');

const countAll = (filter) => MedicationDispense.countDocuments(filter);

const sumQuantitiesByMedicationIds = (medicationIds) =>
  MedicationDispense.aggregate([
    { $match: { medicationId: { $in: medicationIds } } },
    { $group: { _id: '$medicationId', total: { $sum: '$quantity' } } },
  ]);

const sumQuantityByMedicationId = (medicationId) =>
  MedicationDispense.aggregate([
    { $match: { medicationId } },
    { $group: { _id: '$medicationId', total: { $sum: '$quantity' } } },
  ]);

const aggregateUsage = (fromDate, toDate) => {
  const match = {};
  if (fromDate || toDate) {
    match.dispensedAt = {};
    if (fromDate) match.dispensedAt.$gte = fromDate;
    if (toDate) match.dispensedAt.$lte = toDate;
  }

  return MedicationDispense.aggregate([
    { $match: match },
    { $group: { _id: '$medicationId', totalDispensed: { $sum: '$quantity' }, count: { $sum: 1 } } },
  ]);
};

module.exports = {
  create,
  findAll,
  countAll,
  sumQuantitiesByMedicationIds,
  sumQuantityByMedicationId,
  aggregateUsage,
};

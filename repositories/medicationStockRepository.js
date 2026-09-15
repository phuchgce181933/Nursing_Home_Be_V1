const MedicationStock = require('../models/medicationStock');

const create = (data) => MedicationStock.create(data);

const findById = (id) => MedicationStock.findById(id);

const findAll = (filter, { sort, skip, limit }) =>
  MedicationStock.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate('medicationId', 'name medicationCode unit')
    .populate('supplierId', 'name phone email');

const countAll = (filter) => MedicationStock.countDocuments(filter);

const updateById = (id, data) =>
  MedicationStock.findByIdAndUpdate(id, data, { new: true, runValidators: true })
    .populate('medicationId', 'name medicationCode unit')
    .populate('supplierId', 'name phone email');

const sumQuantitiesByMedicationIds = (medicationIds) =>
  MedicationStock.aggregate([
    { $match: { medicationId: { $in: medicationIds } } },
    { $group: { _id: '$medicationId', total: { $sum: '$quantity' } } },
  ]);

const sumQuantityByMedicationId = (medicationId) =>
  MedicationStock.aggregate([
    { $match: { medicationId } },
    { $group: { _id: '$medicationId', total: { $sum: '$quantity' } } },
  ]);

const findExpiring = (fromDate, toDate) => {
  const filter = { expiryDate: { $exists: true } };
  if (fromDate || toDate) {
    filter.expiryDate = {};
    if (fromDate) filter.expiryDate.$gte = fromDate;
    if (toDate) filter.expiryDate.$lte = toDate;
  }
  return MedicationStock.find(filter)
    .sort({ expiryDate: 1 })
    .populate('medicationId', 'name medicationCode unit')
    .populate('supplierId', 'name phone email');
};

// Get the latest cost per unit for a medication
const findLatestCostByMedicationId = (medicationId) =>
  MedicationStock.findOne(
    { medicationId, costPerUnit: { $exists: true, $ne: null } },
    'costPerUnit receivedDate'
  )
    .sort({ receivedDate: -1 })
    .lean();

module.exports = {
  create,
  findById,
  findAll,
  countAll,
  updateById,
  sumQuantitiesByMedicationIds,
  sumQuantityByMedicationId,
  findExpiring,
  findLatestCostByMedicationId,
};

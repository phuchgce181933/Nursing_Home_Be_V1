const ServicePackage = require('../models/servicePackage');

const create = (data) => ServicePackage.create(data);

const findById = (id) => ServicePackage.findById(id);

const findByCode = (code) => ServicePackage.findOne({ packageCode: code });

const findByName = (name, excludeId = null) => {
  const filter = { name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }, isActive: true };
  if (excludeId) filter._id = { $ne: excludeId };
  return ServicePackage.findOne(filter);
};

const findAll = (filter, { sort, skip, limit }) =>
  ServicePackage.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate('createdBy', 'fullName email')
    .populate('updatedBy', 'fullName email');

const countAll = (filter) => ServicePackage.countDocuments(filter);

const updateById = (id, data) =>
  ServicePackage.findByIdAndUpdate(id, data, { new: true, runValidators: true });

const softDelete = (id, updatedBy) =>
  ServicePackage.findByIdAndUpdate(id, { isActive: false, updatedBy }, { new: true });

const findByFilterLean = (filter, { select } = {}) => {
  let q = ServicePackage.find(filter);
  if (select) q = q.select(select);
  return q.lean();
};

module.exports = {
  findByFilterLean,
  create,
  findById,
  findByCode,
  findByName,
  findAll,
  countAll,
  updateById,
  softDelete,
};

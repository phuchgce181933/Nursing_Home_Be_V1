const Supplier = require('../models/supplier');

const create = (data) => Supplier.create(data);

const findById = (id) => Supplier.findById(id);

const findByName = (name, excludeId = null) => {
  const filter = { name: { $regex: `^${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}$`, $options: 'i' } };
  if (excludeId) filter._id = { $ne: excludeId };
  return Supplier.findOne(filter);
};

const findAll = (filter, { sort, skip, limit }) =>
  Supplier.find(filter).sort(sort).skip(skip).limit(limit);

const countAll = (filter) => Supplier.countDocuments(filter);

const updateById = (id, data) =>
  Supplier.findByIdAndUpdate(id, data, { new: true, runValidators: true });

const softDelete = (id, updatedBy) =>
  Supplier.findByIdAndUpdate(id, { isActive: false, updatedBy }, { new: true });

module.exports = {
  create,
  findById,
  findByName,
  findAll,
  countAll,
  updateById,
  softDelete,
};

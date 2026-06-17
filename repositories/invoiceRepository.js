const Invoice = require('../models/invoice');

const create = async (data) => Invoice.create(data);

const findById = async (id) => Invoice.findById(id).populate('residentId familyAccountId');

const updateById = async (id, update) =>
  Invoice.findByIdAndUpdate(id, update, { new: true });

const findByResidentId = async (residentId, { sort = { issuedAt: -1 }, skip = 0, limit = 50 } = {}) =>
  Invoice.find({ residentId }).sort(sort).skip(skip).limit(limit);

const findAll = async (filter, { sort = { issuedAt: -1 }, skip = 0, limit = 50 } = {}) =>
  Invoice.find(filter).populate('residentId familyAccountId').sort(sort).skip(skip).limit(limit);

const countAll = async (filter) => Invoice.countDocuments(filter);

module.exports = {
  create,
  findById,
  updateById,
  findByResidentId,
  findAll,
  countAll,
};

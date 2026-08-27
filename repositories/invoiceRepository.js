const Invoice = require('../models/invoice');

const create = async (data) => Invoice.create(data);

const findById = async (id) => Invoice.findById(id).populate('residentId familyAccountId');

const findByPayosOrderCode = async (orderCode) => Invoice.find({ payosOrderCode: Number(orderCode) });

const updateById = async (id, update) =>
  Invoice.findByIdAndUpdate(id, update, { new: true });

const findByResidentId = async (residentId, { sort = { issuedAt: -1 }, skip = 0, limit = 50 } = {}) =>
  Invoice.find({ residentId }).sort(sort).skip(skip).limit(limit);

const findAll = async (filter, { sort = { issuedAt: -1 }, skip = 0, limit = 50 } = {}) =>
  Invoice.find(filter).populate('residentId familyAccountId').sort(sort).skip(skip).limit(limit);

const countAll = async (filter) => Invoice.countDocuments(filter);

const findByFilterLean = async (filter, { sort = { createdAt: -1 }, limit = 200, select } = {}) => {
  let q = Invoice.find(filter);
  if (select) q = q.select(select);
  return q.sort(sort).limit(limit).lean();
};

const findByIdLean = async (id) => Invoice.findById(id).lean();

const saveDoc = async (doc, opts) => doc.save(opts);

const findUnpaidByResidentId = async (residentId, { sort = { issuedAt: -1 }, skip = 0, limit = 0 } = {}) =>
  Invoice.find({ residentId, status: { $in: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID'] } }).sort(sort).skip(skip).limit(limit);

module.exports = {
  create,
  findById,
  findByIdLean,
  findByPayosOrderCode,
  updateById,
  findByResidentId,
  findAll,
  findByFilterLean,
  countAll,
  findUnpaidByResidentId,
  saveDoc,
};

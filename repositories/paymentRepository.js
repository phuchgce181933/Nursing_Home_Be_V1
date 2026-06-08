const Payment = require('../models/payment');

const create = async (data) => Payment.create(data);

const findByInvoiceId = async (invoiceId, { sort = { paidAt: -1 }, skip = 0, limit = 50 } = {}) =>
  Payment.find({ invoiceId }).sort(sort).skip(skip).limit(limit);

const findById = async (id) => Payment.findById(id).populate('invoiceId paidByFamilyAccountId');

module.exports = {
  create,
  findByInvoiceId,
  findById,
};

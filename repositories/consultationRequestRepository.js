const { ConsultationRequest } = require('../models');

const create = async (data) => ConsultationRequest.create(data);

const count = async (filter) => ConsultationRequest.countDocuments(filter);

const find = async (filter, { page = 1, limit = 20, sort = { createdAt: -1 } } = {}) => {
  const skip = (page - 1) * limit;
  return ConsultationRequest.find(filter).sort(sort).skip(skip).limit(limit).lean();
};

const findById = async (id) => ConsultationRequest.findById(id).lean();

const updateById = async (id, update) => ConsultationRequest.findByIdAndUpdate(id, update, { new: true });

module.exports = {
  create,
  count,
  find,
  findById,
  updateById,
};

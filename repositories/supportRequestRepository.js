const { SupportRequest } = require('../models');

const create = async (data) => {
  return SupportRequest.create(data);
};

const count = async (filter) => {
  return SupportRequest.countDocuments(filter);
};

const find = async (filter, { page = 1, limit = 20, sort = { createdAt: -1 } } = {}) => {
  const skip = (page - 1) * limit;
  return SupportRequest.find(filter).sort(sort).skip(skip).limit(limit).lean();
};

const findById = async (id) => {
  return SupportRequest.findById(id).lean();
};

const findOne = async (filter) => {
  return SupportRequest.findOne(filter).lean();
};

const findDocById = async (id) => {
  return SupportRequest.findById(id);
};

const updateById = async (id, update) => {
  return SupportRequest.findByIdAndUpdate(id, update, { new: true });
};

module.exports = {
  create,
  count,
  find,
  findById,
  findOne,
  findDocById,
  updateById,
};

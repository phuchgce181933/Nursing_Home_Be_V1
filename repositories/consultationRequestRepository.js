const { ConsultationRequest } = require('../models');

const create = async (data) => ConsultationRequest.create(data);

const count = async (filter) => ConsultationRequest.countDocuments(filter);

const countByStatus = async (filter) => {
  const statuses = ['open', 'in_progress', 'resolved', 'closed'];
  const results = await Promise.all(statuses.map((status) => ConsultationRequest.countDocuments({ ...filter, status })));
  return statuses.reduce((counts, status, index) => {
    counts[status] = results[index];
    return counts;
  }, {});
};

const find = async (filter, { page = 1, limit = 20, sort = { createdAt: -1 } } = {}) => {
  const skip = (page - 1) * limit;
  return ConsultationRequest.find(filter).sort(sort).skip(skip).limit(limit).lean();
};

const findById = async (id) => ConsultationRequest.findById(id).lean();

const updateById = async (id, update) => ConsultationRequest.findByIdAndUpdate(id, update, { new: true });

module.exports = {
  create,
  count,
  countByStatus,
  find,
  findById,
  updateById,
};

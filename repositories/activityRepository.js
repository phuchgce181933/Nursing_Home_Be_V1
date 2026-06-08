const Activity = require('../models/activity');

const create = async (data) => Activity.create(data);

const find = async (filter, { sort = { scheduledAt: 1 }, skip = 0, limit = 100 } = {}) =>
  Activity.find(filter).sort(sort).skip(skip).limit(limit);

const count = async (filter) => Activity.countDocuments(filter);

const findById = async (id) => Activity.findById(id);

const findByIdAndUpdate = async (id, update) =>
  Activity.findByIdAndUpdate(id, update, { new: true, runValidators: true });

const deleteById = async (id) => Activity.findByIdAndDelete(id);

const aggregate = async (pipeline) => Activity.aggregate(pipeline);

module.exports = {
  create,
  find,
  count,
  findById,
  findByIdAndUpdate,
  deleteById,
  aggregate,
};

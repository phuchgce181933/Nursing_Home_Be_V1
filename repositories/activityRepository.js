const Activity = require('../models/activity');

const create = async (data) => Activity.create(data);

const find = async (filter, { sort = { scheduledAt: 1 }, skip = 0, limit = 100 } = {}) =>
  Activity.find(filter).sort(sort).skip(skip).limit(limit);

const count = async (filter) => Activity.countDocuments(filter);

const findById = async (id) => Activity.findById(id);

const findByIdAndUpdate = async (id, update) =>
  Activity.findByIdAndUpdate(id, update, { new: true, runValidators: true });

const updateMany = async (filter, update) => Activity.updateMany(filter, update);

const deleteById = async (id) => Activity.findByIdAndDelete(id);

const deleteMany = async (filter) => Activity.deleteMany(filter);

const aggregate = async (pipeline) => Activity.aggregate(pipeline);

module.exports = {
  create,
  find,
  count,
  findById,
  findByIdAndUpdate,
  updateMany,
  deleteById,
  deleteMany,
  aggregate,
};

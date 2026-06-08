const CareScheduleDay = require('../models/careScheduleDay');

const create = async (data, options = {}) => CareScheduleDay.create([data], options).then((rows) => rows[0]);

const findById = async (id) =>
  CareScheduleDay.findById(id)
    .populate({ path: 'createdBy', select: 'fullName role' })
    .populate({ path: 'publishedBy', select: 'fullName role' });

const findAll = async (filter, { skip = 0, limit = 20, sort = { workDate: 1, createdAt: -1 } } = {}) =>
  CareScheduleDay.find(filter).sort(sort).skip(skip).limit(limit);

const countAll = async (filter) => CareScheduleDay.countDocuments(filter);

const updateById = async (id, data, options = {}) =>
  CareScheduleDay.findByIdAndUpdate(id, data, { new: true, runValidators: true, ...options });

const deleteById = async (id, options = {}) => CareScheduleDay.findByIdAndDelete(id, options);

module.exports = {
  create,
  findById,
  findAll,
  countAll,
  updateById,
  deleteById,
};


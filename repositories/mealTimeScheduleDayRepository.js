const MealTimeScheduleDay = require('../models/mealTimeScheduleDay');

const create = async (data, options = {}) =>
  MealTimeScheduleDay.create([data], options).then((rows) => rows[0]);

const findById = async (id) =>
  MealTimeScheduleDay.findById(id)
    .populate({ path: 'createdBy', select: 'fullName role' })
    .populate({ path: 'publishedBy', select: 'fullName role' });

const findAll = async (filter, { skip = 0, limit = 20, sort = { workDate: 1, createdAt: -1 } } = {}) =>
  MealTimeScheduleDay.find(filter).sort(sort).skip(skip).limit(limit);

const countAll = async (filter) => MealTimeScheduleDay.countDocuments(filter);

const updateById = async (id, data, options = {}) =>
  MealTimeScheduleDay.findByIdAndUpdate(id, data, { new: true, runValidators: true, ...options });

const deleteById = async (id, options = {}) => MealTimeScheduleDay.findByIdAndDelete(id, options);

const findPublishedByWorkDate = async (workDate) => {
  const workDateStr =
    typeof workDate === 'string' && workDate.length >= 10
      ? workDate.slice(0, 10)
      : workDate.toISOString().slice(0, 10);
  return MealTimeScheduleDay.findOne({
    status: 'published',
    workDate: {
      $gte: new Date(`${workDateStr}T00:00:00.000Z`),
      $lte: new Date(`${workDateStr}T23:59:59.999Z`),
    },
  }).sort({ publishedAt: -1 });
};

const findByFilterLean = async (filter, { populate, sort } = {}) => {
  let q = MealTimeScheduleDay.find(filter);
  if (populate) q = q.populate(populate);
  if (sort) q = q.sort(sort);
  return q.lean();
};

module.exports = {
  create,
  findById,
  findAll,
  countAll,
  updateById,
  deleteById,
  findPublishedByWorkDate,
  findByFilterLean,
};

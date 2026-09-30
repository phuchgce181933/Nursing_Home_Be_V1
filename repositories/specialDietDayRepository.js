const SpecialDietDay = require('../models/specialDietDay');

const create = async (data, options = {}) => SpecialDietDay.create([data], options).then((rows) => rows[0]);

const findById = async (id) =>
  SpecialDietDay.findById(id)
    .populate({ path: 'createdBy', select: 'fullName role' })
    .populate({ path: 'publishedBy', select: 'fullName role' });

const findAll = async (filter, { skip = 0, limit = 20, sort = { workDate: 1, createdAt: -1 } } = {}) =>
  SpecialDietDay.find(filter).sort(sort).skip(skip).limit(limit);

const countAll = async (filter) => SpecialDietDay.countDocuments(filter);

const updateById = async (id, data, options = {}) =>
  SpecialDietDay.findByIdAndUpdate(id, data, { new: true, runValidators: true, ...options });

const deleteById = async (id, options = {}) => SpecialDietDay.findByIdAndDelete(id, options);

const findByFilterLean = async (filter, { populate, sort } = {}) => {
  let q = SpecialDietDay.find(filter);
  if (populate) q = q.populate(populate);
  if (sort) q = q.sort(sort);
  return q.lean();
};

const workDateRangeFilter = (workDateStr) => ({
  $gte: new Date(`${workDateStr}T00:00:00.000Z`),
  $lte: new Date(`${workDateStr}T23:59:59.999Z`),
});

/**
 * Bản công bố mới nhất của ngày làm việc — cùng quy ước với
 * rehabilitationScheduleDayRepository.findPublishedByWorkDate.
 */
const findPublishedByWorkDate = async (workDateStr) =>
  SpecialDietDay.findOne({
    status: 'published',
    workDate: workDateRangeFilter(workDateStr),
  })
    .sort({ publishedAt: -1 })
    .lean();

module.exports = {
  create,
  findById,
  findAll,
  countAll,
  updateById,
  deleteById,
  findByFilterLean,
  workDateRangeFilter,
  findPublishedByWorkDate,
};

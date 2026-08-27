const MealTimeScheduleEntry = require('../models/mealTimeScheduleEntry');
const MealTimeScheduleDay = require('../models/mealTimeScheduleDay');
const { workDateRangeFilter } = require('../utils/publishedMealPlanLookup');

const POPULATE = [
  {
    path: 'residentId',
    select: 'fullName residentCode roomId',
    populate: { path: 'roomId', select: 'roomNumber' },
  },
];

const normalizeWorkDateStr = (workDate) =>
  typeof workDate === 'string' && workDate.length >= 10
    ? workDate.slice(0, 10)
    : workDate.toISOString().slice(0, 10);

const findPublishedDaysByWorkDate = async (workDate) =>
  MealTimeScheduleDay.find({
    status: 'published',
    workDate: workDateRangeFilter(normalizeWorkDateStr(workDate)),
  })
    .sort({ publishedAt: -1 })
    .lean();

const createMany = async (rows, options = {}) => MealTimeScheduleEntry.insertMany(rows, options);

const findByDayId = async (mealTimeScheduleDayId) =>
  MealTimeScheduleEntry.find({ mealTimeScheduleDayId }).populate(POPULATE).sort({ createdAt: 1 });

const deleteByDayId = async (mealTimeScheduleDayId, options = {}) =>
  MealTimeScheduleEntry.deleteMany({ mealTimeScheduleDayId }, options);

const findByPublishedWorkDate = async (workDate, residentIds = []) => {
  const days = await findPublishedDaysByWorkDate(workDate);
  if (!days.length) return [];

  const ids = residentIds.map(String).filter(Boolean);
  if (!ids.length) {
    return MealTimeScheduleEntry.find({ mealTimeScheduleDayId: days[0]._id })
      .populate(POPULATE)
      .lean();
  }

  const result = [];
  const unfound = new Set(ids);

  for (const day of days) {
    if (unfound.size === 0) break;
    const entries = await MealTimeScheduleEntry.find({
      mealTimeScheduleDayId: day._id,
      residentId: { $in: [...unfound] },
    })
      .populate(POPULATE)
      .lean();

    const foundInDay = new Set();
    for (const entry of entries) {
      const rid = String(entry.residentId?._id || entry.residentId);
      foundInDay.add(rid);
      result.push(entry);
    }
    for (const rid of foundInDay) {
      unfound.delete(rid);
    }
  }

  return result;
};

const findByFilterLean = async (filter, { populate } = {}) => {
  let q = MealTimeScheduleEntry.find(filter);
  if (populate) q = q.populate(populate);
  return q.lean();
};

module.exports = {
  createMany,
  findByDayId,
  deleteByDayId,
  findByPublishedWorkDate,
  findByFilterLean,
};

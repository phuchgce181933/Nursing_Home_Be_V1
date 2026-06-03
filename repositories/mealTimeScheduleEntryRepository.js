const MealTimeScheduleEntry = require('../models/mealTimeScheduleEntry');

const POPULATE = [
  {
    path: 'residentId',
    select: 'fullName residentCode roomId',
    populate: { path: 'roomId', select: 'roomNumber' },
  },
];

const createMany = async (rows, options = {}) => MealTimeScheduleEntry.insertMany(rows, options);

const findByDayId = async (mealTimeScheduleDayId) =>
  MealTimeScheduleEntry.find({ mealTimeScheduleDayId }).populate(POPULATE).sort({ createdAt: 1 });

const deleteByDayId = async (mealTimeScheduleDayId, options = {}) =>
  MealTimeScheduleEntry.deleteMany({ mealTimeScheduleDayId }, options);

const findByPublishedWorkDate = async (workDate, residentIds = []) => {
  const dayRepo = require('./mealTimeScheduleDayRepository');
  const day = await dayRepo.findPublishedByWorkDate(workDate);
  if (!day) return [];

  const query = { mealTimeScheduleDayId: day._id };
  if (residentIds.length) {
    query.residentId = { $in: residentIds };
  }
  return MealTimeScheduleEntry.find(query).populate(POPULATE).lean();
};

module.exports = {
  createMany,
  findByDayId,
  deleteByDayId,
  findByPublishedWorkDate,
};

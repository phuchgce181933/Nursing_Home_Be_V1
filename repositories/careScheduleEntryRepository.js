const CareScheduleEntry = require('../models/careScheduleEntry');

const POPULATE = [
  { path: 'residentId', select: 'fullName residentCode roomId', populate: { path: 'roomId', select: 'roomNumber' } },
  { path: 'staffProfileId', select: 'staffCode roleCategory userId', populate: { path: 'userId', select: 'fullName role' } },
  { path: 'shiftId', select: 'name startTime endTime workDate status assignedStaffId' },
];

const createMany = async (rows, options = {}) => CareScheduleEntry.insertMany(rows, options);

const findByDayId = async (careScheduleDayId) =>
  CareScheduleEntry.find({ careScheduleDayId }).populate(POPULATE).sort({ scheduledTime: 1 });

const deleteByDayId = async (careScheduleDayId, options = {}) =>
  CareScheduleEntry.deleteMany({ careScheduleDayId }, options);

module.exports = {
  createMany,
  findByDayId,
  deleteByDayId,
};


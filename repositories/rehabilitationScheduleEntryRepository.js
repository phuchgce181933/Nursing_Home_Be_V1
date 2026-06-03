const RehabilitationScheduleEntry = require('../models/rehabilitationScheduleEntry');

const findByDayId = async (dayId) =>
  RehabilitationScheduleEntry.find({ rehabilitationScheduleDayId: dayId }).lean();

const findByDayIdAndResidents = async (dayId, residentIds) =>
  RehabilitationScheduleEntry.find({
    rehabilitationScheduleDayId: dayId,
    residentId: { $in: residentIds },
  }).lean();

module.exports = {
  findByDayId,
  findByDayIdAndResidents,
};

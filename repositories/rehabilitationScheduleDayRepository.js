const RehabilitationScheduleDay = require('../models/rehabilitationScheduleDay');

const workDateRangeFilter = (workDateStr) => ({
  $gte: new Date(`${workDateStr}T00:00:00.000Z`),
  $lte: new Date(`${workDateStr}T23:59:59.999Z`),
});

const findPublishedByWorkDate = async (workDateStr) =>
  RehabilitationScheduleDay.findOne({
    status: 'published',
    workDate: workDateRangeFilter(workDateStr),
  })
    .sort({ publishedAt: -1 })
    .lean();

module.exports = {
  workDateRangeFilter,
  findPublishedByWorkDate,
};

const MealTimeScheduleDay = require('../models/mealTimeScheduleDay');
const MealTimeScheduleEntry = require('../models/mealTimeScheduleEntry');
const SpecialDietDay = require('../models/specialDietDay');
const SpecialDietEntry = require('../models/specialDietEntry');
const { apiErr, CODES } = require('./apiError');
const { workDateRangeFilter } = require('./publishedMealPlanLookup');

const findPublishedScheduleConflicts = async (workDateStr, residentIds, excludeScheduleDayId) => {
  const ids = [...new Set((residentIds || []).map(String).filter(Boolean))];
  if (!ids.length) return [];

  const dayFilter = {
    status: 'published',
    workDate: workDateRangeFilter(workDateStr),
  };
  if (excludeScheduleDayId) {
    dayFilter._id = { $ne: excludeScheduleDayId };
  }

  const days = await MealTimeScheduleDay.find(dayFilter)
    .populate({ path: 'publishedBy', select: 'fullName' })
    .lean();
  if (!days.length) return [];

  const conflicts = [];
  for (const day of days) {
    const entries = await MealTimeScheduleEntry.find({
      mealTimeScheduleDayId: day._id,
      residentId: { $in: ids },
    })
      .populate({ path: 'residentId', select: 'fullName residentCode' })
      .lean();

    for (const entry of entries) {
      conflicts.push({
        residentId: String(entry.residentId?._id || entry.residentId),
        residentName: entry.residentId?.fullName || entry.residentId?.residentCode || '',
        scheduleTitle: day.title || null,
        publishedByName: day.publishedBy?.fullName || null,
      });
    }
  }

  return conflicts;
};

const findPublishedSpecialDietConflicts = async (workDateStr, residentIds, excludeSpecialDietDayId) => {
  const ids = [...new Set((residentIds || []).map(String).filter(Boolean))];
  if (!ids.length) return [];

  const dayFilter = {
    status: 'published',
    workDate: workDateRangeFilter(workDateStr),
  };
  if (excludeSpecialDietDayId) {
    dayFilter._id = { $ne: excludeSpecialDietDayId };
  }

  const days = await SpecialDietDay.find(dayFilter)
    .populate({ path: 'publishedBy', select: 'fullName' })
    .lean();
  if (!days.length) return [];

  const conflicts = [];
  for (const day of days) {
    const entries = await SpecialDietEntry.find({
      specialDietDayId: day._id,
      residentId: { $in: ids },
    })
      .populate({ path: 'residentId', select: 'fullName residentCode' })
      .lean();

    for (const entry of entries) {
      conflicts.push({
        residentId: String(entry.residentId?._id || entry.residentId),
        residentName: entry.residentId?.fullName || entry.residentId?.residentCode || '',
        planTitle: day.title || null,
        publishedByName: day.publishedBy?.fullName || null,
      });
    }
  }

  return conflicts;
};

const assertNoPublishedScheduleConflicts = async (workDateStr, residentIds, excludeScheduleDayId) => {
  const conflicts = await findPublishedScheduleConflicts(workDateStr, residentIds, excludeScheduleDayId);
  if (!conflicts.length) return;

  const names = [...new Set(conflicts.map((c) => c.residentName).filter(Boolean))];
  throw apiErr(CODES.MEAL_TIME_SCHEDULE_PUBLISH_DUPLICATE_RESIDENT, {
    statusCode: 400,
    params: { residents: names.join(', ') },
  });
};

const assertNoPublishedSpecialDietConflicts = async (workDateStr, residentIds, excludeSpecialDietDayId) => {
  const conflicts = await findPublishedSpecialDietConflicts(workDateStr, residentIds, excludeSpecialDietDayId);
  if (!conflicts.length) return;

  const names = [...new Set(conflicts.map((c) => c.residentName).filter(Boolean))];
  throw apiErr(CODES.MEAL_SPECIAL_DIET_PUBLISH_DUPLICATE_RESIDENT, {
    statusCode: 400,
    params: { residents: names.join(', ') },
  });
};

module.exports = {
  findPublishedScheduleConflicts,
  findPublishedSpecialDietConflicts,
  assertNoPublishedScheduleConflicts,
  assertNoPublishedSpecialDietConflicts,
};

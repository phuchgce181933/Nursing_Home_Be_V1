const mealTimeScheduleDayRepo = require('../repositories/mealTimeScheduleDayRepository');
const mealTimeScheduleEntryRepo = require('../repositories/mealTimeScheduleEntryRepository');
const specialDietDayRepo = require('../repositories/specialDietDayRepository');
const specialDietEntryRepo = require('../repositories/specialDietEntryRepository');
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

  const days = await mealTimeScheduleDayRepo.findByFilterLean(dayFilter, {
    populate: { path: 'publishedBy', select: 'fullName' },
  });
  if (!days.length) return [];

  const conflicts = [];
  for (const day of days) {
    const entries = await mealTimeScheduleEntryRepo.findByFilterLean(
      { mealTimeScheduleDayId: day._id, residentId: { $in: ids } },
      { populate: { path: 'residentId', select: 'fullName residentCode' } }
    );

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

  const days = await specialDietDayRepo.findByFilterLean(dayFilter, {
    populate: { path: 'publishedBy', select: 'fullName' },
  });
  if (!days.length) return [];

  const conflicts = [];
  for (const day of days) {
    const entries = await specialDietEntryRepo.findByFilterLean(
      { specialDietDayId: day._id, residentId: { $in: ids } },
      { populate: { path: 'residentId', select: 'fullName residentCode' } }
    );

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

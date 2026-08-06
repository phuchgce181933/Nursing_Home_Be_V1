const mongoose = require('mongoose');
const { apiErr, CODES } = require('../utils/apiError');
const MealTimeScheduleDay = require('../models/mealTimeScheduleDay');
const SpecialDietDay = require('../models/specialDietDay');
const SpecialDietEntry = require('../models/specialDietEntry');
const mealTimeScheduleEntryRepo = require('../repositories/mealTimeScheduleEntryRepository');
const { parseWorkDate } = require('../utils/shiftTime');
const {
  workDateRangeFilter,
  findPublishedMealsForResident,
} = require('../utils/publishedMealPlanLookup');

const parseWorkDateStrict = (workDate) => {
  const str = String(workDate || '').trim();
  try {
    parseWorkDate(str);
  } catch {
    throw apiErr(CODES.MEAL_WORK_DATE_INVALID, { statusCode: 400 });
  }
  return str;
};

const parseResidentIds = (input) => {
  const raw = Array.isArray(input)
    ? input
    : String(input || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  const ids = [...new Set(raw.filter((id) => mongoose.Types.ObjectId.isValid(id)).map(String))];
  return ids;
};

const publisherName = (day) => day?.publishedBy?.fullName || null;

const buildMealTimeCoverageForResidents = async (workDate, residentIds) => {
  const coverage = {};
  if (!residentIds.length) return coverage;

  const entries = await mealTimeScheduleEntryRepo.findByPublishedWorkDate(workDate, residentIds);
  if (!entries.length) return coverage;

  const dayIds = [...new Set(entries.map((e) => String(e.mealTimeScheduleDayId)))];
  const days = await MealTimeScheduleDay.find({ _id: { $in: dayIds } })
    .populate({ path: 'publishedBy', select: 'fullName' })
    .lean();
  const dayMap = Object.fromEntries(days.map((d) => [String(d._id), d]));

  for (const entry of entries) {
    const rid = String(entry.residentId?._id || entry.residentId);
    if (coverage[rid]) continue;
    const day = dayMap[String(entry.mealTimeScheduleDayId)] || {};
    coverage[rid] = {
      published: true,
      scheduleTitle: day.title || null,
      publishedByName: publisherName(day),
      breakfastTime: entry.breakfastTime,
      lunchTime: entry.lunchTime,
      dinnerTime: entry.dinnerTime,
    };
  }

  return coverage;
};

const buildMealPlanCoverageForResident = async (workDate, residentId) => {
  const { entries, day } = await findPublishedMealsForResident(residentId, workDate);
  if (!day || !entries.length) {
    return { published: false };
  }

  const populatedDay = await require('../models/mealPlanDay')
    .findById(day._id)
    .populate({ path: 'publishedBy', select: 'fullName' })
    .lean();

  return {
    published: true,
    planTitle: day.title || null,
    mealTypes: [...new Set(entries.map((e) => e.mealType))],
    publishedByName: publisherName(populatedDay),
  };
};

const buildSpecialDietCoverageForResident = async (workDate, residentId) => {
  const days = await SpecialDietDay.find({
    status: 'published',
    workDate: workDateRangeFilter(workDate),
  })
    .sort({ publishedAt: -1 })
    .populate({ path: 'publishedBy', select: 'fullName' })
    .lean();

  for (const day of days) {
    const entries = await SpecialDietEntry.find({
      specialDietDayId: day._id,
      residentId,
    }).lean();
    if (!entries.length) continue;

    return {
      published: true,
      planTitle: day.title || null,
      dietTypes: [...new Set(entries.map((e) => e.dietType))],
      publishedByName: publisherName(day),
    };
  }

  return { published: false };
};

const getCoverage = async (query = {}) => {
  const workDate = parseWorkDateStrict(query.workDate);
  const residentIds = parseResidentIds(query.residentIds);

  const mealTimeByResident = await buildMealTimeCoverageForResidents(workDate, residentIds);

  const byResident = {};
  for (const residentId of residentIds) {
    byResident[residentId] = {
      mealTimeSchedule: mealTimeByResident[residentId] || { published: false },
      mealPlan: await buildMealPlanCoverageForResident(workDate, residentId),
      specialDiet: await buildSpecialDietCoverageForResident(workDate, residentId),
    };
  }

  return { workDate, byResident };
};

module.exports = {
  getCoverage,
  buildMealTimeCoverageForResidents,
  buildMealPlanCoverageForResident,
  buildSpecialDietCoverageForResident,
};

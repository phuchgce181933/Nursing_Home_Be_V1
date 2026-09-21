const mongoose = require('mongoose');
const residentRepo = require('../repositories/residentRepository');
const mealPlanDayRepo = require('../repositories/mealPlanDayRepository');
const mealPlanEntryRepo = require('../repositories/mealPlanEntryRepository');
const specialDietDayRepo = require('../repositories/specialDietDayRepository');
const specialDietEntryRepo = require('../repositories/specialDietEntryRepository');
const mealTimeScheduleDayRepo = require('../repositories/mealTimeScheduleDayRepository');
const mealTimeScheduleEntryRepo = require('../repositories/mealTimeScheduleEntryRepository');
const careNoteRepo = require('../repositories/careNoteRepository');
const mealIntakeNoteRepo = require('../repositories/mealIntakeNoteRepository');
const { getAssignedResidentIdSetForUser } = require('./assignedResidentService');
const { apiErr, CODES } = require('../utils/apiError');
const {
  parseWorkDate,
  todayVN,
  addDaysToDateStr,
  workDateToVNString,
} = require('../utils/shiftTime');

const MAX_RANGE_DAYS = 31;
const DEFAULT_RANGE_DAYS = 7;

const workDateRangeFilter = (fromStr, toStr) => ({
  $gte: new Date(`${fromStr}T00:00:00.000Z`),
  $lte: new Date(`${toStr}T23:59:59.999Z`),
});

const noteAtRangeFilter = (fromStr, toStr) => ({
  $gte: new Date(`${fromStr}T00:00:00.000Z`),
  $lte: new Date(`${toStr}T23:59:59.999Z`),
});

const parsePeriod = (query = {}) => {
  const to = String(query.to || todayVN()).trim();
  const from = String(query.from || addDaysToDateStr(to, -(DEFAULT_RANGE_DAYS - 1))).trim();

  try {
    parseWorkDate(from);
    parseWorkDate(to);
  } catch {
    throw apiErr(CODES.WORK_DATE_RANGE_INVALID, { statusCode: 400 });
  }

  if (from > to) {
    throw apiErr(CODES.WORK_DATE_FROM_TO_INVALID, { statusCode: 400 });
  }

  const start = new Date(`${from}T12:00:00.000Z`);
  const end = new Date(`${to}T12:00:00.000Z`);
  const diffDays = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
  if (diffDays > MAX_RANGE_DAYS) {
    throw apiErr(CODES.WORK_DATE_RANGE_TOO_LONG, { statusCode: 400, params: { maxDays: MAX_RANGE_DAYS } });
  }

  return { from, to };
};

const idOf = (value) => String(value?._id || value || '');

const findPublishedDaysInRange = (repo, from, to) =>
  repo.findByFilterLean(
    { status: 'published', workDate: workDateRangeFilter(from, to) },
    { sort: { workDate: 1, publishedAt: -1 } }
  );

const groupEntriesByResidentAndDate = (days, entries, dayIdField, entryMapper) => {
  const dayById = new Map(days.map((d) => [String(d._id), d]));
  const map = new Map();

  for (const entry of entries) {
    const day = dayById.get(String(entry[dayIdField]));
    if (!day) continue;
    const workDate = workDateToVNString(day.workDate);
    const residentId = idOf(entry.residentId);
    if (!residentId) continue;

    if (!map.has(residentId)) map.set(residentId, new Map());
    const byDate = map.get(residentId);
    if (!byDate.has(workDate)) byDate.set(workDate, []);
    byDate.get(workDate).push(entryMapper(entry, day));
  }

  return map;
};

const loadNutritionContext = async (from, to, actorUser) => {
  if (!actorUser?._id) {
    throw apiErr(CODES.USER_NOT_IDENTIFIED, { statusCode: 401 });
  }

  const assignedIds = await getAssignedResidentIdSetForUser(actorUser._id);
  const residentFilter =
    assignedIds.size > 0
      ? { _id: { $in: [...assignedIds] }, residencyStatus: 'admitted' }
      : { _id: { $in: [] } };

  const [residents, mealPlanDays, specialDietDays, mealTimeDays, mealNotes, mealIntakeRows] =
    await Promise.all([
      residentRepo.findByFilterLean(residentFilter, {
        select: '_id fullName residentCode allergies chronicConditions',
        sort: { fullName: 1 },
      }),
      findPublishedDaysInRange(mealPlanDayRepo, from, to),
      findPublishedDaysInRange(specialDietDayRepo, from, to),
      findPublishedDaysInRange(mealTimeScheduleDayRepo, from, to),
      careNoteRepo.findNotesWithPopulate(
        { noteType: 'meal', noteAt: noteAtRangeFilter(from, to) },
        { sort: { noteAt: -1 }, skip: 0, limit: 5000 }
      ),
      mealIntakeNoteRepo.findInWorkDateRange(from, to),
    ]);

  const mealPlanDayIds = mealPlanDays.map((d) => d._id);
  const specialDietDayIds = specialDietDays.map((d) => d._id);
  const mealTimeDayIds = mealTimeDays.map((d) => d._id);

  const [mealPlanEntries, specialDietEntries, mealTimeEntries] = await Promise.all([
    mealPlanDayIds.length
      ? mealPlanEntryRepo.findByFilterLean({ mealPlanDayId: { $in: mealPlanDayIds } })
      : [],
    specialDietDayIds.length
      ? specialDietEntryRepo.findByFilterLean({ specialDietDayId: { $in: specialDietDayIds } })
      : [],
    mealTimeDayIds.length
      ? mealTimeScheduleEntryRepo.findByFilterLean({ mealTimeScheduleDayId: { $in: mealTimeDayIds } })
      : [],
  ]);

  const mealPlanMap = groupEntriesByResidentAndDate(
    mealPlanDays,
    mealPlanEntries,
    'mealPlanDayId',
    (entry, day) => ({
      mealType: entry.mealType,
      mealName: entry.mealName,
      calories: entry.calories,
      mealTime: entry.mealTime,
      ingredients: entry.ingredients || [],
      nutritionNote: entry.nutritionNote,
      stageNote: entry.stageNote,
      careStage: day.careStage,
      planTitle: day.title,
    })
  );

  const specialDietMap = groupEntriesByResidentAndDate(
    specialDietDays,
    specialDietEntries,
    'specialDietDayId',
    (entry, day) => ({
      dietType: entry.dietType,
      restrictions: entry.restrictions || [],
      nutritionGoal: entry.nutritionGoal,
      notes: entry.notes,
      effectiveTime: entry.effectiveTime,
      planTitle: day.title,
    })
  );

  const mealTimeMap = groupEntriesByResidentAndDate(
    mealTimeDays,
    mealTimeEntries,
    'mealTimeScheduleDayId',
    (entry, day) => ({
      breakfastTime: entry.breakfastTime,
      lunchTime: entry.lunchTime,
      dinnerTime: entry.dinnerTime,
      notes: entry.notes,
      planTitle: day.title,
    })
  );

  const mealNotesByResident = new Map();
  for (const note of mealNotes) {
    const residentId = idOf(note.residentId);
    if (!residentId) continue;
    if (!mealNotesByResident.has(residentId)) mealNotesByResident.set(residentId, []);
    mealNotesByResident.get(residentId).push({
      _id: note._id,
      content: note.content,
      noteAt: note.noteAt,
      authorName: note.authorStaffId?.userId?.fullName,
    });
  }

  const mealIntakeByResident = new Map();
  for (const row of mealIntakeRows) {
    const residentId = idOf(row.residentId);
    if (!residentId) continue;
    const workDate = workDateToVNString(row.workDate);
    if (!mealIntakeByResident.has(residentId)) mealIntakeByResident.set(residentId, new Map());
    const byDate = mealIntakeByResident.get(residentId);
    if (!byDate.has(workDate)) byDate.set(workDate, []);
    byDate.get(workDate).push({
      _id: row._id,
      mealType: row.mealType,
      intakeStatus: row.intakeStatus,
      portionPercent: row.portionPercent,
      plannedMealName: row.plannedMealName,
      notes: row.notes,
      recordedAt: row.recordedAt,
      authorName: row.recordedByStaffId?.userId?.fullName,
    });
  }

  const residentsWithMealPlan = new Set(mealPlanMap.keys());
  const residentsWithSpecialDiet = new Set(specialDietMap.keys());
  const residentsWithMealTimeSchedule = new Set(mealTimeMap.keys());
  const residentsWithMealIntake = new Set(mealIntakeByResident.keys());

  return {
    from,
    to,
    residents,
    mealPlanMap,
    specialDietMap,
    mealTimeMap,
    mealNotesByResident,
    mealIntakeByResident,
    residentsWithMealPlan,
    residentsWithSpecialDiet,
    residentsWithMealTimeSchedule,
    residentsWithMealIntake,
    totalMealNotes: mealNotes.length,
    totalMealIntakeRecords: mealIntakeRows.length,
  };
};

const buildResidentRow = (resident, ctx) => {
  const residentId = idOf(resident._id);
  const notes = ctx.mealNotesByResident.get(residentId) || [];
  const intakesByDate = ctx.mealIntakeByResident.get(residentId);
  let mealIntakeCount = 0;
  let lastMealIntakeAt = null;
  if (intakesByDate) {
    for (const rows of intakesByDate.values()) {
      mealIntakeCount += rows.length;
      for (const row of rows) {
        if (!lastMealIntakeAt || new Date(row.recordedAt) > new Date(lastMealIntakeAt)) {
          lastMealIntakeAt = row.recordedAt;
        }
      }
    }
  }
  const lastMealNoteAt = notes.length ? notes[0].noteAt : null;

  return {
    residentId,
    fullName: resident.fullName,
    residentCode: resident.residentCode,
    allergies: resident.allergies || [],
    chronicConditions: resident.chronicConditions || [],
    hasMealPlan: ctx.residentsWithMealPlan.has(residentId),
    hasSpecialDiet: ctx.residentsWithSpecialDiet.has(residentId),
    hasMealTimeSchedule: ctx.residentsWithMealTimeSchedule.has(residentId),
    hasMealIntake: ctx.residentsWithMealIntake.has(residentId),
    mealNotesCount: notes.length,
    mealIntakeCount,
    lastMealNoteAt,
    lastMealIntakeAt,
  };
};

const getSummary = async (query, actorUser) => {
  const { from, to } = parsePeriod(query);
  const ctx = await loadNutritionContext(from, to, actorUser);

  const missingMealPlan = ctx.residents.filter((r) => !ctx.residentsWithMealPlan.has(idOf(r._id)));

  return {
    generatedAt: new Date(),
    period: { from, to },
    totalAdmittedResidents: ctx.residents.length,
    residentsWithMealPlan: ctx.residentsWithMealPlan.size,
    residentsWithSpecialDiet: ctx.residentsWithSpecialDiet.size,
    residentsWithMealTimeSchedule: ctx.residentsWithMealTimeSchedule.size,
    totalMealNotes: ctx.totalMealNotes,
    totalMealIntakeRecords: ctx.totalMealIntakeRecords,
    residentsWithMealIntake: ctx.residentsWithMealIntake.size,
    residentsMissingMealPlan: missingMealPlan.length,
    residentsMissingMealPlanList: missingMealPlan.slice(0, 20).map((r) => ({
      residentId: idOf(r._id),
      fullName: r.fullName,
      residentCode: r.residentCode,
    })),
  };
};

const listResidents = async (query, actorUser) => {
  const { from, to } = parsePeriod(query);
  const ctx = await loadNutritionContext(from, to, actorUser);

  const search = String(query.search || '').trim().toLowerCase();
  let rows = ctx.residents.map((r) => buildResidentRow(r, ctx));

  if (search) {
    rows = rows.filter(
      (r) =>
        (r.fullName || '').toLowerCase().includes(search) ||
        (r.residentCode || '').toLowerCase().includes(search)
    );
  }

  if (query.missingMealPlan === 'true') {
    rows = rows.filter((r) => !r.hasMealPlan);
  }

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;
  const total = rows.length;
  const data = rows.slice(skip, skip + limit);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1, period: { from, to } };
};

const getResidentReport = async (residentId, query, actorUser) => {
  if (!mongoose.Types.ObjectId.isValid(String(residentId || ''))) {
    throw apiErr(CODES.RESIDENT_INVALID_ID, { statusCode: 400 });
  }
  if (!actorUser?._id) {
    throw apiErr(CODES.USER_NOT_IDENTIFIED, { statusCode: 401 });
  }

  const assignedIds = await getAssignedResidentIdSetForUser(actorUser._id);
  if (!assignedIds.has(String(residentId))) {
    throw apiErr(CODES.CAREGIVER_RESIDENT_NOT_ASSIGNED, { statusCode: 403 });
  }

  const { from, to } = parsePeriod(query);
  const ctx = await loadNutritionContext(from, to, actorUser);

  const resident = ctx.residents.find((r) => idOf(r._id) === String(residentId));
  if (!resident) {
    throw apiErr(CODES.RESIDENT_ADMITTED_NOT_FOUND, { statusCode: 404 });
  }

  const rid = String(residentId);
  const mealByDate = ctx.mealPlanMap.get(rid) || new Map();
  const dietByDate = ctx.specialDietMap.get(rid) || new Map();
  const timeByDate = ctx.mealTimeMap.get(rid) || new Map();
  const allNotes = ctx.mealNotesByResident.get(rid) || [];
  const intakeByDate = ctx.mealIntakeByResident.get(rid) || new Map();

  const dateSet = new Set([
    ...mealByDate.keys(),
    ...dietByDate.keys(),
    ...timeByDate.keys(),
    ...intakeByDate.keys(),
  ]);

  for (const note of allNotes) {
    const noteDate = workDateToVNString(note.noteAt);
    if (noteDate >= from && noteDate <= to) dateSet.add(noteDate);
  }

  const days = [...dateSet]
    .sort()
    .map((workDate) => {
      const dayNotes = allNotes.filter((n) => workDateToVNString(n.noteAt) === workDate);
      const mealPlanEntries = mealByDate.get(workDate) || [];
      const specialDietEntries = dietByDate.get(workDate) || [];
      const mealTimeRows = timeByDate.get(workDate) || [];
      const mealIntakeNotes = intakeByDate.get(workDate) || [];
      return {
        workDate,
        mealPlanEntries,
        specialDietEntries,
        mealTimeSchedule: mealTimeRows[0] || null,
        mealIntakeNotes,
        mealNotes: dayNotes,
      };
    })
    .filter(
      (d) =>
        d.mealPlanEntries.length ||
        d.specialDietEntries.length ||
        d.mealTimeSchedule ||
        d.mealIntakeNotes.length ||
        d.mealNotes.length
    );

  const mealPlanMealCount = [...mealByDate.values()].reduce((sum, arr) => sum + arr.length, 0);
  const mealIntakeCount = [...intakeByDate.values()].reduce((sum, arr) => sum + arr.length, 0);

  return {
    generatedAt: new Date(),
    period: { from, to },
    resident: {
      residentId: rid,
      fullName: resident.fullName,
      residentCode: resident.residentCode,
      allergies: resident.allergies || [],
      chronicConditions: resident.chronicConditions || [],
    },
    summary: {
      daysWithData: days.length,
      mealPlanMealCount,
      specialDietEntryCount: [...dietByDate.values()].reduce((sum, arr) => sum + arr.length, 0),
      hasMealTimeSchedule: timeByDate.size > 0,
      mealNotesCount: allNotes.length,
      mealIntakeCount,
      hasMealPlan: ctx.residentsWithMealPlan.has(rid),
      hasMealIntake: ctx.residentsWithMealIntake.has(rid),
    },
    days,
  };
};

module.exports = {
  getSummary,
  listResidents,
  getResidentReport,
};

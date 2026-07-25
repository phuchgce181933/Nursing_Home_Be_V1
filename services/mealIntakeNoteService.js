const mongoose = require('mongoose');
const { apiErr, apiSuccess, CODES, SUCCESS } = require('../utils/apiError');
const mealIntakeNoteRepo = require('../repositories/mealIntakeNoteRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const Resident = require('../models/resident');
const mealTimeScheduleService = require('./mealTimeScheduleService');
const assignedResidentService = require('./assignedResidentService');
const { findPublishedMealPlanEntryForResident } = require('../utils/publishedMealPlanLookup');
const { parseWorkDate, todayVN, workDateToVNString } = require('../utils/shiftTime');
const { getCaregiverRecordingWindow, assertCaregiverRecordingWindowOpen } = require('../utils/mealIntakeShiftWindow');

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const INTAKE_STATUSES = ['full', 'partial', 'refused', 'assisted'];

const parseWorkDateStrict = (workDate) => {
  const str = String(workDate || '').trim();
  try {
    parseWorkDate(str);
  } catch {
    throw apiErr(CODES.WORK_DATE_INVALID_FORMAT, { statusCode: 400 });
  }
  return str;
};

const workDateToDate = (workDateStr) => new Date(`${workDateStr}T00:00:00.000Z`);

const assertValidObjectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
    throw apiErr(CODES.CAREGIVER_INVALID_OBJECT_ID, { statusCode: 400, params: { label } });
  }
};

const getCaregiverProfile = async (userId) => {
  const profile = await staffProfileRepo.findByUserId(userId);
  if (!profile) {
    throw apiErr(CODES.CAREGIVER_STAFF_PROFILE_NOT_FOUND, { statusCode: 400 });
  }
  return profile;
};

const assertResidentAssigned = async (profile, residentId) => {
  const assigned = (profile.assignedResidentIds || []).map((r) => String(r._id || r));
  if (!assigned.includes(String(residentId))) {
    throw apiErr(CODES.CAREGIVER_RESIDENT_NOT_ASSIGNED, { statusCode: 403 });
  }
  const resident = await Resident.findById(residentId).select('_id residencyStatus fullName residentCode');
  if (!resident || resident.residencyStatus !== 'admitted') {
    throw apiErr(CODES.CAREGIVER_RESIDENT_NOT_ADMITTED, { statusCode: 400 });
  }
  return resident;
};

const assertFieldOneOf = (field, value, allowed) => {
  if (!allowed.includes(value)) {
    throw apiErr(CODES.FIELD_MUST_BE_ONE_OF, {
      statusCode: 400,
      params: { field, allowed: allowed.join(', ') },
    });
  }
};

const validateIntakePayload = (body, isUpdate = false) => {
  const row = body || {};
  if (!isUpdate) {
    assertValidObjectId(row.residentId, 'residentId');
    assertFieldOneOf('mealType', row.mealType, MEAL_TYPES);
    const workDate = parseWorkDateStrict(row.workDate);
    if (workDate > todayVN()) {
      throw apiErr(CODES.WORK_DATE_FUTURE_NOT_ALLOWED, { statusCode: 400 });
    }
  }

  if (row.intakeStatus !== undefined) {
    assertFieldOneOf('intakeStatus', row.intakeStatus, INTAKE_STATUSES);
  }

  if (row.notes !== undefined && String(row.notes).trim().length > 500) {
    throw apiErr(CODES.RESIDENT_LIST_ITEM_LENGTH_INVALID, { statusCode: 400, params: { field: 'notes', min: 0, max: 500 } });
  }
  if (row.plannedMealName !== undefined && String(row.plannedMealName).trim().length > 200) {
    throw apiErr(CODES.RESIDENT_LIST_ITEM_LENGTH_INVALID, { statusCode: 400, params: { field: 'plannedMealName', min: 0, max: 200 } });
  }

  const status = row.intakeStatus;
  if (status === 'partial' || (isUpdate && row.portionPercent !== undefined)) {
    const pct = row.portionPercent;
    if (status === 'partial' && (pct === undefined || pct === null || pct === '')) {
      throw apiErr(CODES.PORTION_PERCENT_REQUIRED, { statusCode: 400 });
    }
    if (pct !== undefined && pct !== null && pct !== '') {
      const num = Number(pct);
      if (Number.isNaN(num) || num < 0 || num > 100) {
        throw apiErr(CODES.PORTION_PERCENT_INVALID, { statusCode: 400 });
      }
    }
  }

  return row;
};

const assertRecordingWindowOpen = async (profileId, workDateStr) =>
  assertCaregiverRecordingWindowOpen(profileId, workDateStr, CODES.MEAL_INTAKE_SHIFT_WINDOW_CLOSED);

const findPublishedMealPlanEntry = async (residentId, workDateStr, mealType) => {
  const { entry } = await findPublishedMealPlanEntryForResident(residentId, workDateStr, mealType);
  return entry;
};

const getMealContext = async (residentId, workDateInput, mealType, userId) => {
  assertValidObjectId(residentId, 'residentId');
  assertFieldOneOf('mealType', mealType, MEAL_TYPES);
  const workDate = parseWorkDateStrict(workDateInput);
  const profile = await getCaregiverProfile(userId);
  await assertResidentAssigned(profile, residentId);

  const planEntry = await findPublishedMealPlanEntry(residentId, workDate, mealType);
  const mealTime = await mealTimeScheduleService.resolveMealTimeForResident(
    workDate,
    residentId,
    mealType
  );

  const existing = await mealIntakeNoteRepo.findOneByUnique(
    residentId,
    workDateToDate(workDate),
    mealType
  );

  const { canMutate } = await getCaregiverRecordingWindow(profile._id, workDate);

  const existingRecordedByName = existing
    ? existing.recordedByStaffId?.userId?.fullName ||
      existing.recordedByStaffId?.staffCode ||
      null
    : null;

  return {
    workDate,
    mealType,
    plannedMeal: planEntry
      ? {
          mealName: planEntry.mealName,
          calories: planEntry.calories,
          mealTime: planEntry.mealTime || mealTime,
          nutritionNote: planEntry.nutritionNote,
        }
      : null,
    scheduledMealTime: mealTime,
    existingRecordId: existing?._id || null,
    hasExistingRecord: Boolean(existing),
    existingRecordedByName,
    existingRecordedAt: existing?.recordedAt || null,
    canRecord: canMutate,
  };
};

const listAssignedResidents = async (userId) =>
  assignedResidentService.listAssignedResidentsForUser(userId, { fields: 'minimal' });

const listIntakeNotes = async (userId, query) => {
  const profile = await getCaregiverProfile(userId);
  const assignedIds = (profile.assignedResidentIds || []).map((r) => r._id || r);

  const filter = { residentId: { $in: assignedIds } };
  if (query.residentId) {
    assertValidObjectId(query.residentId, 'residentId');
    if (!assignedIds.map(String).includes(String(query.residentId))) {
      throw apiErr(CODES.CAREGIVER_RESIDENT_NOT_ASSIGNED, { statusCode: 403 });
    }
    filter.residentId = query.residentId;
  }
  if (query.mealType) {
    assertFieldOneOf('mealType', query.mealType, MEAL_TYPES);
    filter.mealType = query.mealType;
  }
  if (query.workDate) {
    const wd = parseWorkDateStrict(query.workDate);
    filter.workDate = workDateToDate(wd);
  }

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const skip = (page - 1) * limit;

  let meta = { canMutate: false };
  if (query.workDate) {
    const wd = parseWorkDateStrict(query.workDate);
    const { canMutate } = await getCaregiverRecordingWindow(profile._id, wd);
    meta = { canMutate };
  }

  const [data, total] = await Promise.all([
    mealIntakeNoteRepo.findAll(filter, { skip, limit }),
    mealIntakeNoteRepo.countAll(filter),
  ]);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1, meta };
};

const listIntakeNotesForAdmin = async (query) => {
  const filter = {};
  if (query.residentId) {
    assertValidObjectId(query.residentId, 'residentId');
    filter.residentId = query.residentId;
  }
  if (query.mealType) {
    assertFieldOneOf('mealType', query.mealType, MEAL_TYPES);
    filter.mealType = query.mealType;
  }
  if (query.workDate) {
    const wd = parseWorkDateStrict(query.workDate);
    filter.workDate = workDateToDate(wd);
  }

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    mealIntakeNoteRepo.findAll(filter, { skip, limit }),
    mealIntakeNoteRepo.countAll(filter),
  ]);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const createIntakeNote = async (userId, body) => {
  validateIntakePayload(body, false);
  const workDate = parseWorkDateStrict(body.workDate);
  const profile = await getCaregiverProfile(userId);
  await assertResidentAssigned(profile, body.residentId);
  await assertRecordingWindowOpen(profile._id, workDate);

  const workDateDate = workDateToDate(workDate);
  const existing = await mealIntakeNoteRepo.findOneByUnique(
    body.residentId,
    workDateDate,
    body.mealType
  );
  if (existing) {
    throw apiErr(CODES.DUPLICATE_RECORD, { statusCode: 400 });
  }

  const planEntry = await findPublishedMealPlanEntry(body.residentId, workDate, body.mealType);
  if (!planEntry?.mealName) {
    throw apiErr(CODES.RECORD_NOT_FOUND, { statusCode: 400 });
  }
  const plannedMealName = body.plannedMealName?.trim() || planEntry.mealName;

  const portionPercent =
    body.intakeStatus === 'partial' ? Number(body.portionPercent) : body.portionPercent ?? undefined;

  const note = await mealIntakeNoteRepo.create({
    residentId: body.residentId,
    workDate: workDateDate,
    mealType: body.mealType,
    intakeStatus: body.intakeStatus,
    portionPercent,
    plannedMealName: plannedMealName || undefined,
    notes: body.notes?.trim() || undefined,
    recordedByStaffId: profile._id,
    recordedAt: new Date(),
  });

  return mealIntakeNoteRepo.findById(note._id);
};

const assertAuthor = (note, profile) => {
  if (String(note.recordedByStaffId?._id || note.recordedByStaffId) !== String(profile._id)) {
    throw apiErr(CODES.CAREGIVER_NOT_RECORD_OWNER, { statusCode: 403 });
  }
};

const getIntakeNote = async (userId, id) => {
  const note = await mealIntakeNoteRepo.findById(id);
  if (!note) throw apiErr(CODES.MEAL_INTAKE_RECORD_NOT_FOUND, { statusCode: 404 });
  const profile = await getCaregiverProfile(userId);
  await assertResidentAssigned(profile, note.residentId?._id || note.residentId);
  return note;
};

const updateIntakeNote = async (userId, id, body) => {
  const note = await mealIntakeNoteRepo.findById(id);
  if (!note) throw apiErr(CODES.MEAL_INTAKE_RECORD_NOT_FOUND, { statusCode: 404 });
  const profile = await getCaregiverProfile(userId);
  assertAuthor(note, profile);
  await assertResidentAssigned(profile, note.residentId?._id || note.residentId);
  await assertRecordingWindowOpen(profile._id, workDateToVNString(note.workDate));
  validateIntakePayload(body, true);

  const update = {};
  if (body.intakeStatus !== undefined) update.intakeStatus = body.intakeStatus;
  if (body.notes !== undefined) update.notes = body.notes?.trim() || undefined;
  if (body.plannedMealName !== undefined) update.plannedMealName = body.plannedMealName?.trim() || undefined;

  const status = body.intakeStatus ?? note.intakeStatus;
  if (body.portionPercent !== undefined || status === 'partial') {
    if (status === 'partial') {
      const pct = body.portionPercent ?? note.portionPercent;
      if (pct === undefined || pct === null) {
        throw apiErr(CODES.PORTION_PERCENT_REQUIRED, { statusCode: 400 });
      }
      update.portionPercent = Number(pct);
    } else if (body.portionPercent !== undefined) {
      update.portionPercent = body.portionPercent === '' ? undefined : Number(body.portionPercent);
    } else {
      update.portionPercent = undefined;
    }
  }

  return mealIntakeNoteRepo.updateById(id, update);
};

const deleteIntakeNote = async (userId, id) => {
  const note = await mealIntakeNoteRepo.findById(id);
  if (!note) throw apiErr(CODES.MEAL_INTAKE_RECORD_NOT_FOUND, { statusCode: 404 });
  const profile = await getCaregiverProfile(userId);
  assertAuthor(note, profile);
  await assertResidentAssigned(profile, note.residentId?._id || note.residentId);
  await assertRecordingWindowOpen(profile._id, workDateToVNString(note.workDate));
  await mealIntakeNoteRepo.deleteById(id);
  return { ...apiSuccess(SUCCESS.MEAL_INTAKE_RECORD_DELETED), deleted: true, id };
};

module.exports = {
  MEAL_TYPES,
  INTAKE_STATUSES,
  listAssignedResidents,
  getMealContext,
  listIntakeNotes,
  listIntakeNotesForAdmin,
  createIntakeNote,
  getIntakeNote,
  updateIntakeNote,
  deleteIntakeNote,
  findPublishedMealPlanEntry,
};

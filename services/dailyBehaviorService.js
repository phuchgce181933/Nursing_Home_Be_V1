const mongoose = require('mongoose');
const { apiErr, apiSuccess, CODES, SUCCESS } = require('../utils/apiError');
const dailyBehaviorRepo = require('../repositories/dailyBehaviorRecordRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const Resident = require('../models/resident');
const assignedResidentService = require('./assignedResidentService');
const {
  OBSERVATION_CATEGORIES,
  MOOD_LEVELS,
  BEHAVIOR_TYPES,
  SEVERITY_LEVELS,
} = require('../models/dailyBehaviorRecord');
const { parseWorkDate, todayVN, workDateToVNString, VN_TZ } = require('../utils/shiftTime');
const {
  getCaregiverRecordingWindow,
  assertCaregiverRecordingWindowOpen,
} = require('../utils/mealIntakeShiftWindow');

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

const parseObservedAt = (observedAtInput, workDateStr) => {
  if (!observedAtInput) return new Date();
  const d = new Date(observedAtInput);
  if (Number.isNaN(d.getTime())) {
    throw apiErr(CODES.OBSERVED_AT_INVALID, { statusCode: 400 });
  }
  if (d > new Date()) {
    throw apiErr(CODES.OBSERVED_AT_FUTURE, { statusCode: 400 });
  }
  const observedDayVN = d.toLocaleDateString('en-CA', { timeZone: VN_TZ });
  if (observedDayVN !== workDateStr) {
    throw apiErr(CODES.OBSERVED_AT_OUT_OF_DAY, { statusCode: 400 });
  }
  return d;
};

const assertFieldOneOf = (field, value, allowed) => {
  if (!allowed.includes(value)) {
    throw apiErr(CODES.FIELD_MUST_BE_ONE_OF, {
      statusCode: 400,
      params: { field, allowed: allowed.join(', ') },
    });
  }
};

const validatePayload = (body, isUpdate = false) => {
  const row = body || {};

  if (!isUpdate) {
    assertValidObjectId(row.residentId, 'residentId');
    assertFieldOneOf('observationCategory', row.observationCategory, OBSERVATION_CATEGORIES);
    const workDate = parseWorkDateStrict(row.workDate);
    if (workDate > todayVN()) {
      throw apiErr(CODES.WORK_DATE_FUTURE_NOT_ALLOWED, { statusCode: 400 });
    }
    const notes = String(row.notes || '').trim();
    if (notes.length < 5) {
      throw apiErr(CODES.NOTES_TOO_SHORT, { statusCode: 400, params: { min: 5 } });
    }
  }

  if (row.observationCategory !== undefined) {
    assertFieldOneOf('observationCategory', row.observationCategory, OBSERVATION_CATEGORIES);
  }

  if (row.moodLevel !== undefined && row.moodLevel !== null && row.moodLevel !== '') {
    assertFieldOneOf('moodLevel', row.moodLevel, MOOD_LEVELS);
  }

  if (row.behaviorType !== undefined && row.behaviorType !== null && row.behaviorType !== '') {
    assertFieldOneOf('behaviorType', row.behaviorType, BEHAVIOR_TYPES);
  }

  if (row.severity !== undefined) {
    assertFieldOneOf('severity', row.severity, SEVERITY_LEVELS);
  }

  if (row.notes !== undefined && String(row.notes).trim().length < 5) {
    throw apiErr(CODES.NOTES_TOO_SHORT, { statusCode: 400, params: { min: 5 } });
  }
  if (row.notes !== undefined && String(row.notes).trim().length > 500) {
    throw apiErr(CODES.RESIDENT_LIST_ITEM_LENGTH_INVALID, { statusCode: 400, params: { field: 'notes', min: 5, max: 500 } });
  }

  const category = row.observationCategory;
  if (!isUpdate && category === 'mood' && !row.moodLevel) {
    throw apiErr(CODES.MOOD_LEVEL_REQUIRED, { statusCode: 400 });
  }

  if (!isUpdate && category === 'abnormal' && row.severity === 'normal') {
    throw apiErr(CODES.SEVERITY_TOO_LOW_FOR_ABNORMAL, { statusCode: 400 });
  }

  return row;
};

const listAssignedResidents = async (userId) =>
  assignedResidentService.listAssignedResidentsForUser(userId, { fields: 'minimal' });

const listRecords = async (userId, query) => {
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
  if (query.observationCategory) {
    assertFieldOneOf('observationCategory', query.observationCategory, OBSERVATION_CATEGORIES);
    filter.observationCategory = query.observationCategory;
  }
  if (query.severity) {
    assertFieldOneOf('severity', query.severity, SEVERITY_LEVELS);
    filter.severity = query.severity;
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
    dailyBehaviorRepo.findAll(filter, { skip, limit, sort: { observedAt: -1 } }),
    dailyBehaviorRepo.countAll(filter),
  ]);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1, meta };
};

const listRecordsForAdmin = async (query) => {
  const filter = {};
  if (query.residentId) {
    assertValidObjectId(query.residentId, 'residentId');
    filter.residentId = query.residentId;
  }
  if (query.observationCategory) {
    assertFieldOneOf('observationCategory', query.observationCategory, OBSERVATION_CATEGORIES);
    filter.observationCategory = query.observationCategory;
  }
  if (query.severity) {
    assertFieldOneOf('severity', query.severity, SEVERITY_LEVELS);
    filter.severity = query.severity;
  }
  if (query.workDate) {
    const wd = parseWorkDateStrict(query.workDate);
    filter.workDate = workDateToDate(wd);
  }

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    dailyBehaviorRepo.findAll(filter, { skip, limit, sort: { observedAt: -1 } }),
    dailyBehaviorRepo.countAll(filter),
  ]);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const createRecord = async (userId, body) => {
  validatePayload(body, false);
  const workDate = parseWorkDateStrict(body.workDate);
  const profile = await getCaregiverProfile(userId);
  await assertResidentAssigned(profile, body.residentId);
  await assertCaregiverRecordingWindowOpen(
    profile._id,
    workDate,
    CODES.BEHAVIOR_SHIFT_WINDOW_CLOSED
  );

  const category = body.observationCategory;
  if (category === 'mood' && !body.moodLevel) {
    throw apiErr(CODES.MOOD_LEVEL_REQUIRED, { statusCode: 400 });
  }

  let severity = body.severity || 'normal';
  if (category === 'abnormal' && severity === 'normal') {
    severity = 'mild';
  }

  const observedAt = parseObservedAt(body.observedAt, workDate);

  const record = await dailyBehaviorRepo.create({
    residentId: body.residentId,
    workDate: workDateToDate(workDate),
    observedAt,
    observationCategory: category,
    moodLevel: body.moodLevel || undefined,
    behaviorType: body.behaviorType || undefined,
    severity,
    notes: String(body.notes).trim(),
    recordedByStaffId: profile._id,
    recordedAt: new Date(),
  });

  return dailyBehaviorRepo.findById(record._id);
};

const assertAuthor = (record, profile) => {
  if (String(record.recordedByStaffId?._id || record.recordedByStaffId) !== String(profile._id)) {
    throw apiErr(CODES.CAREGIVER_NOT_RECORD_OWNER, { statusCode: 403 });
  }
};

const getRecord = async (userId, id) => {
  const record = await dailyBehaviorRepo.findById(id);
  if (!record) throw apiErr(CODES.BEHAVIOR_RECORD_NOT_FOUND, { statusCode: 404 });
  const profile = await getCaregiverProfile(userId);
  await assertResidentAssigned(profile, record.residentId?._id || record.residentId);
  return record;
};

const updateRecord = async (userId, id, body) => {
  const record = await dailyBehaviorRepo.findById(id);
  if (!record) throw apiErr(CODES.BEHAVIOR_RECORD_NOT_FOUND, { statusCode: 404 });
  const profile = await getCaregiverProfile(userId);
  assertAuthor(record, profile);
  await assertResidentAssigned(profile, record.residentId?._id || record.residentId);
  await assertCaregiverRecordingWindowOpen(
    profile._id,
    workDateToVNString(record.workDate),
    CODES.BEHAVIOR_SHIFT_WINDOW_CLOSED
  );
  validatePayload(body, true);

  const category = body.observationCategory ?? record.observationCategory;
  const moodLevel = body.moodLevel !== undefined ? body.moodLevel : record.moodLevel;
  if (category === 'mood' && !moodLevel) {
    throw apiErr(CODES.MOOD_LEVEL_REQUIRED, { statusCode: 400 });
  }

  // Keep the same invariant createRecord enforces: an 'abnormal' observation can never end up with
  // severity 'normal', whether category or severity (or neither) is the field actually being changed.
  let severity = body.severity !== undefined ? body.severity : record.severity;
  if (category === 'abnormal' && severity === 'normal') {
    severity = 'mild';
  }

  const update = {};
  if (body.observationCategory !== undefined) update.observationCategory = body.observationCategory;
  if (body.moodLevel !== undefined) update.moodLevel = body.moodLevel || undefined;
  if (body.behaviorType !== undefined) update.behaviorType = body.behaviorType || undefined;
  if (severity !== record.severity) update.severity = severity;
  if (body.notes !== undefined) update.notes = String(body.notes).trim();

  if (body.observedAt !== undefined || body.workDate !== undefined) {
    const workDateStr = body.workDate
      ? parseWorkDateStrict(body.workDate)
      : workDateToVNString(record.workDate);
    if (body.workDate) update.workDate = workDateToDate(workDateStr);
    update.observedAt = parseObservedAt(body.observedAt ?? record.observedAt, workDateStr);
  }

  return dailyBehaviorRepo.updateById(id, update);
};

const deleteRecord = async (userId, id) => {
  const record = await dailyBehaviorRepo.findById(id);
  if (!record) throw apiErr(CODES.BEHAVIOR_RECORD_NOT_FOUND, { statusCode: 404 });
  const profile = await getCaregiverProfile(userId);
  assertAuthor(record, profile);
  await assertResidentAssigned(profile, record.residentId?._id || record.residentId);
  await assertCaregiverRecordingWindowOpen(
    profile._id,
    workDateToVNString(record.workDate),
    CODES.BEHAVIOR_SHIFT_WINDOW_CLOSED
  );
  await dailyBehaviorRepo.deleteById(id);
  return { ...apiSuccess(SUCCESS.BEHAVIOR_RECORD_DELETED), deleted: true, id };
};

module.exports = {
  OBSERVATION_CATEGORIES,
  MOOD_LEVELS,
  BEHAVIOR_TYPES,
  SEVERITY_LEVELS,
  listAssignedResidents,
  listRecords,
  listRecordsForAdmin,
  createRecord,
  getRecord,
  updateRecord,
  deleteRecord,
};

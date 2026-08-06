const mongoose = require('mongoose');
const { apiErr, apiSuccess, CODES, SUCCESS } = require('../utils/apiError');
const hygieneActivityRepo = require('../repositories/hygieneActivityRecordRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const Resident = require('../models/resident');
const assignedResidentService = require('./assignedResidentService');
const {
  HYGIENE_CATEGORIES,
  HYGIENE_ACTIVITY_TYPES,
  COMPLETION_STATUSES,
} = require('../models/hygieneActivityRecord');
const { parseWorkDate, todayVN, workDateToVNString } = require('../utils/shiftTime');
const {
  getCaregiverRecordingWindow,
  assertCaregiverRecordingWindowOpen,
} = require('../utils/mealIntakeShiftWindow');

const CATEGORY_BY_TYPE = {
  bathing: 'personal',
  oral_care: 'personal',
  grooming: 'personal',
  toileting: 'personal',
  diaper_change: 'personal',
  room_tidy: 'environment',
  bathroom_clean: 'environment',
  linen_change: 'environment',
  laundry: 'environment',
};

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

const validatePayload = (body, isUpdate = false) => {
  const row = body || {};
  if (!isUpdate) {
    assertValidObjectId(row.residentId, 'residentId');
    assertFieldOneOf('activityType', row.activityType, HYGIENE_ACTIVITY_TYPES);
    const workDate = parseWorkDateStrict(row.workDate);
    if (workDate > todayVN()) {
      throw apiErr(CODES.WORK_DATE_FUTURE_NOT_ALLOWED, { statusCode: 400 });
    }
  }

  if (row.activityType !== undefined) {
    assertFieldOneOf('activityType', row.activityType, HYGIENE_ACTIVITY_TYPES);
  }

  if (row.completionStatus !== undefined) {
    assertFieldOneOf('completionStatus', row.completionStatus, COMPLETION_STATUSES);
  }

  if (row.notes !== undefined && String(row.notes).trim().length > 500) {
    throw apiErr(CODES.RESIDENT_LIST_ITEM_LENGTH_INVALID, { statusCode: 400, params: { field: 'notes', min: 0, max: 500 } });
  }

  return row;
};

const listAssignedResidents = async (userId) =>
  assignedResidentService.listAssignedResidentsForUser(userId, { fields: 'minimal' });

const getActivityContext = async (residentId, workDateInput, activityType, userId) => {
  assertValidObjectId(residentId, 'residentId');
  assertFieldOneOf('activityType', activityType, HYGIENE_ACTIVITY_TYPES);
  const workDate = parseWorkDateStrict(workDateInput);
  const profile = await getCaregiverProfile(userId);
  await assertResidentAssigned(profile, residentId);

  const existing = await hygieneActivityRepo.findOneByUnique(
    residentId,
    workDateToDate(workDate),
    activityType
  );

  const { canMutate } = await getCaregiverRecordingWindow(profile._id, workDate);

  const existingRecordedByName = existing
    ? existing.recordedByStaffId?.userId?.fullName ||
      existing.recordedByStaffId?.staffCode ||
      null
    : null;

  return {
    workDate,
    activityType,
    activityCategory: CATEGORY_BY_TYPE[activityType],
    existingRecordId: existing?._id || null,
    hasExistingRecord: Boolean(existing),
    existingRecordedByName,
    existingRecordedAt: existing?.recordedAt || null,
    canRecord: canMutate,
  };
};

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
  if (query.activityCategory) {
    assertFieldOneOf('activityCategory', query.activityCategory, HYGIENE_CATEGORIES);
    filter.activityCategory = query.activityCategory;
  }
  if (query.activityType) {
    assertFieldOneOf('activityType', query.activityType, HYGIENE_ACTIVITY_TYPES);
    filter.activityType = query.activityType;
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
    hygieneActivityRepo.findAll(filter, { skip, limit, sort: { recordedAt: -1 } }),
    hygieneActivityRepo.countAll(filter),
  ]);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1, meta };
};

const listRecordsForAdmin = async (query) => {
  const filter = {};
  if (query.residentId) {
    assertValidObjectId(query.residentId, 'residentId');
    filter.residentId = query.residentId;
  }
  if (query.activityCategory) {
    assertFieldOneOf('activityCategory', query.activityCategory, HYGIENE_CATEGORIES);
    filter.activityCategory = query.activityCategory;
  }
  if (query.activityType) {
    assertFieldOneOf('activityType', query.activityType, HYGIENE_ACTIVITY_TYPES);
    filter.activityType = query.activityType;
  }
  if (query.workDate) {
    const wd = parseWorkDateStrict(query.workDate);
    filter.workDate = workDateToDate(wd);
  }

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    hygieneActivityRepo.findAll(filter, { skip, limit, sort: { recordedAt: -1 } }),
    hygieneActivityRepo.countAll(filter),
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
    CODES.HYGIENE_SHIFT_WINDOW_CLOSED
  );

  const workDateDate = workDateToDate(workDate);
  const existing = await hygieneActivityRepo.findOneByUnique(
    body.residentId,
    workDateDate,
    body.activityType
  );
  if (existing) {
    throw apiErr(CODES.DUPLICATE_RECORD, { statusCode: 400 });
  }

  const activityCategory = CATEGORY_BY_TYPE[body.activityType];
  const record = await hygieneActivityRepo.create({
    residentId: body.residentId,
    workDate: workDateDate,
    activityCategory,
    activityType: body.activityType,
    completionStatus: body.completionStatus,
    notes: body.notes?.trim() || undefined,
    recordedByStaffId: profile._id,
    recordedAt: new Date(),
  });

  return hygieneActivityRepo.findById(record._id);
};

const assertAuthor = (record, profile) => {
  if (String(record.recordedByStaffId?._id || record.recordedByStaffId) !== String(profile._id)) {
    throw apiErr(CODES.CAREGIVER_NOT_RECORD_OWNER, { statusCode: 403 });
  }
};

const getRecord = async (userId, id) => {
  const record = await hygieneActivityRepo.findById(id);
  if (!record) throw apiErr(CODES.HYGIENE_RECORD_NOT_FOUND, { statusCode: 404 });
  const profile = await getCaregiverProfile(userId);
  await assertResidentAssigned(profile, record.residentId?._id || record.residentId);
  return record;
};

const updateRecord = async (userId, id, body) => {
  const record = await hygieneActivityRepo.findById(id);
  if (!record) throw apiErr(CODES.HYGIENE_RECORD_NOT_FOUND, { statusCode: 404 });
  const profile = await getCaregiverProfile(userId);
  assertAuthor(record, profile);
  await assertResidentAssigned(profile, record.residentId?._id || record.residentId);
  await assertCaregiverRecordingWindowOpen(
    profile._id,
    workDateToVNString(record.workDate),
    CODES.HYGIENE_SHIFT_WINDOW_CLOSED
  );
  validatePayload(body, true);

  const update = {};
  if (body.completionStatus !== undefined) update.completionStatus = body.completionStatus;
  if (body.notes !== undefined) update.notes = body.notes?.trim() || undefined;

  return hygieneActivityRepo.updateById(id, update);
};

const deleteRecord = async (userId, id) => {
  const record = await hygieneActivityRepo.findById(id);
  if (!record) throw apiErr(CODES.HYGIENE_RECORD_NOT_FOUND, { statusCode: 404 });
  const profile = await getCaregiverProfile(userId);
  assertAuthor(record, profile);
  await assertResidentAssigned(profile, record.residentId?._id || record.residentId);
  await assertCaregiverRecordingWindowOpen(
    profile._id,
    workDateToVNString(record.workDate),
    CODES.HYGIENE_SHIFT_WINDOW_CLOSED
  );
  await hygieneActivityRepo.deleteById(id);
  return { ...apiSuccess(SUCCESS.HYGIENE_RECORD_DELETED), deleted: true, id };
};

module.exports = {
  HYGIENE_CATEGORIES,
  HYGIENE_ACTIVITY_TYPES,
  COMPLETION_STATUSES,
  CATEGORY_BY_TYPE,
  listAssignedResidents,
  getActivityContext,
  listRecords,
  listRecordsForAdmin,
  createRecord,
  getRecord,
  updateRecord,
  deleteRecord,
};

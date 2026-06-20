const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const hygieneActivityRepo = require('../repositories/hygieneActivityRecordRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const Resident = require('../models/resident');
const assignedResidentService = require('./assignedResidentService');
const {
  HYGIENE_CATEGORIES,
  HYGIENE_ACTIVITY_TYPES,
  COMPLETION_STATUSES,
} = require('../models/hygieneActivityRecord');
const { parseWorkDate, todayVN } = require('../utils/shiftTime');

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

const DUPLICATE_MSG =
  'Đã ghi nhận hoạt động này cho cư dân trong ngày. Vui lòng chỉnh sửa bản ghi hiện có.';

const parseWorkDateStrict = (workDate) => {
  const str = String(workDate || '').trim();
  try {
    parseWorkDate(str);
  } catch {
    throw new ServiceError('workDate phải đúng định dạng YYYY-MM-DD', 400);
  }
  return str;
};

const workDateToDate = (workDateStr) => new Date(`${workDateStr}T00:00:00.000Z`);

const assertValidObjectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
    throw new ServiceError(`${label} không hợp lệ`, 400);
  }
};

const getCaregiverProfile = async (userId) => {
  const profile = await staffProfileRepo.findByUserId(userId);
  if (!profile) {
    throw new ServiceError('Không tìm thấy hồ sơ nhân viên. Vui lòng liên hệ quản trị.', 400);
  }
  return profile;
};

const assertResidentAssigned = async (profile, residentId) => {
  const assigned = (profile.assignedResidentIds || []).map((r) => String(r._id || r));
  if (!assigned.includes(String(residentId))) {
    throw new ServiceError('Cư dân không thuộc danh sách phụ trách của bạn', 403);
  }
  const resident = await Resident.findById(residentId).select('_id residencyStatus fullName residentCode');
  if (!resident || resident.residencyStatus !== 'admitted') {
    throw new ServiceError('Cư dân không tồn tại hoặc không ở trạng thái đang ở viện', 400);
  }
  return resident;
};

const validatePayload = (body, isUpdate = false) => {
  const row = body || {};
  if (!isUpdate) {
    assertValidObjectId(row.residentId, 'residentId');
    if (!HYGIENE_ACTIVITY_TYPES.includes(row.activityType)) {
      throw new ServiceError(
        `activityType phải thuộc một trong: ${HYGIENE_ACTIVITY_TYPES.join(', ')}`,
        400
      );
    }
    const workDate = parseWorkDateStrict(row.workDate);
    if (workDate > todayVN()) {
      throw new ServiceError('Không thể ghi nhận cho ngày trong tương lai', 400);
    }
  }

  if (row.activityType !== undefined && !HYGIENE_ACTIVITY_TYPES.includes(row.activityType)) {
    throw new ServiceError(
      `activityType phải thuộc một trong: ${HYGIENE_ACTIVITY_TYPES.join(', ')}`,
      400
    );
  }

  if (
    row.completionStatus !== undefined &&
    !COMPLETION_STATUSES.includes(row.completionStatus)
  ) {
    throw new ServiceError(
      `completionStatus phải thuộc một trong: ${COMPLETION_STATUSES.join(', ')}`,
      400
    );
  }

  return row;
};

const listAssignedResidents = async (userId) =>
  assignedResidentService.listAssignedResidentsForUser(userId, { fields: 'minimal' });

const getActivityContext = async (residentId, workDateInput, activityType, userId) => {
  assertValidObjectId(residentId, 'residentId');
  if (!HYGIENE_ACTIVITY_TYPES.includes(activityType)) {
    throw new ServiceError(
      `activityType phải thuộc một trong: ${HYGIENE_ACTIVITY_TYPES.join(', ')}`,
      400
    );
  }
  const workDate = parseWorkDateStrict(workDateInput);
  const profile = await getCaregiverProfile(userId);
  await assertResidentAssigned(profile, residentId);

  const existing = await hygieneActivityRepo.findOneByUnique(
    residentId,
    workDateToDate(workDate),
    activityType
  );

  return {
    workDate,
    activityType,
    activityCategory: CATEGORY_BY_TYPE[activityType],
    existingRecordId: existing?._id || null,
    hasExistingRecord: Boolean(existing),
  };
};

const listRecords = async (userId, query) => {
  const profile = await getCaregiverProfile(userId);
  const assignedIds = (profile.assignedResidentIds || []).map((r) => r._id || r);

  const filter = { residentId: { $in: assignedIds } };
  if (query.residentId) {
    assertValidObjectId(query.residentId, 'residentId');
    if (!assignedIds.map(String).includes(String(query.residentId))) {
      throw new ServiceError('Cư dân không thuộc danh sách phụ trách của bạn', 403);
    }
    filter.residentId = query.residentId;
  }
  if (query.activityCategory) {
    if (!HYGIENE_CATEGORIES.includes(query.activityCategory)) {
      throw new ServiceError(
        `activityCategory phải thuộc một trong: ${HYGIENE_CATEGORIES.join(', ')}`,
        400
      );
    }
    filter.activityCategory = query.activityCategory;
  }
  if (query.activityType) {
    if (!HYGIENE_ACTIVITY_TYPES.includes(query.activityType)) {
      throw new ServiceError(
        `activityType phải thuộc một trong: ${HYGIENE_ACTIVITY_TYPES.join(', ')}`,
        400
      );
    }
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

  const workDateDate = workDateToDate(workDate);
  const existing = await hygieneActivityRepo.findOneByUnique(
    body.residentId,
    workDateDate,
    body.activityType
  );
  if (existing) {
    throw new ServiceError(DUPLICATE_MSG, 400);
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
    throw new ServiceError('Chỉ người ghi nhận mới được sửa hoặc xóa bản ghi này', 403);
  }
};

const getRecord = async (userId, id) => {
  const record = await hygieneActivityRepo.findById(id);
  if (!record) throw new ServiceError('Không tìm thấy bản ghi hoạt động vệ sinh', 404);
  const profile = await getCaregiverProfile(userId);
  await assertResidentAssigned(profile, record.residentId?._id || record.residentId);
  return record;
};

const updateRecord = async (userId, id, body) => {
  const record = await hygieneActivityRepo.findById(id);
  if (!record) throw new ServiceError('Không tìm thấy bản ghi hoạt động vệ sinh', 404);
  const profile = await getCaregiverProfile(userId);
  assertAuthor(record, profile);
  await assertResidentAssigned(profile, record.residentId?._id || record.residentId);
  validatePayload(body, true);

  const update = {};
  if (body.completionStatus !== undefined) update.completionStatus = body.completionStatus;
  if (body.notes !== undefined) update.notes = body.notes?.trim() || undefined;

  return hygieneActivityRepo.updateById(id, update);
};

const deleteRecord = async (userId, id) => {
  const record = await hygieneActivityRepo.findById(id);
  if (!record) throw new ServiceError('Không tìm thấy bản ghi hoạt động vệ sinh', 404);
  const profile = await getCaregiverProfile(userId);
  assertAuthor(record, profile);
  await assertResidentAssigned(profile, record.residentId?._id || record.residentId);
  await hygieneActivityRepo.deleteById(id);
  return { message: 'Đã xóa bản ghi hoạt động vệ sinh', deleted: true, id };
};

module.exports = {
  HYGIENE_CATEGORIES,
  HYGIENE_ACTIVITY_TYPES,
  COMPLETION_STATUSES,
  CATEGORY_BY_TYPE,
  listAssignedResidents,
  getActivityContext,
  listRecords,
  createRecord,
  getRecord,
  updateRecord,
  deleteRecord,
};

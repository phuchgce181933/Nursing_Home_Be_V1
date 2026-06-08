const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
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

const parseObservedAt = (observedAtInput, workDateStr) => {
  if (!observedAtInput) return new Date();
  const d = new Date(observedAtInput);
  if (Number.isNaN(d.getTime())) {
    throw new ServiceError('observedAt không hợp lệ', 400);
  }
  if (d > new Date()) {
    throw new ServiceError('Thời điểm quan sát không được ở tương lai', 400);
  }
  const observedDayVN = d.toLocaleDateString('en-CA', { timeZone: VN_TZ });
  if (observedDayVN !== workDateStr) {
    throw new ServiceError('Thời điểm quan sát phải nằm trong ngày ghi nhận', 400);
  }
  return d;
};

const validatePayload = (body, isUpdate = false) => {
  const row = body || {};

  if (!isUpdate) {
    assertValidObjectId(row.residentId, 'residentId');
    if (!OBSERVATION_CATEGORIES.includes(row.observationCategory)) {
      throw new ServiceError(
        `observationCategory phải thuộc một trong: ${OBSERVATION_CATEGORIES.join(', ')}`,
        400
      );
    }
    const workDate = parseWorkDateStrict(row.workDate);
    if (workDate > todayVN()) {
      throw new ServiceError('Không thể ghi nhận cho ngày trong tương lai', 400);
    }
    const notes = String(row.notes || '').trim();
    if (notes.length < 5) {
      throw new ServiceError('notes phải có ít nhất 5 ký tự', 400);
    }
  }

  if (row.observationCategory !== undefined && !OBSERVATION_CATEGORIES.includes(row.observationCategory)) {
    throw new ServiceError(
      `observationCategory phải thuộc một trong: ${OBSERVATION_CATEGORIES.join(', ')}`,
      400
    );
  }

  if (row.moodLevel !== undefined && row.moodLevel !== null && row.moodLevel !== '') {
    if (!MOOD_LEVELS.includes(row.moodLevel)) {
      throw new ServiceError(`moodLevel phải thuộc một trong: ${MOOD_LEVELS.join(', ')}`, 400);
    }
  }

  if (row.behaviorType !== undefined && row.behaviorType !== null && row.behaviorType !== '') {
    if (!BEHAVIOR_TYPES.includes(row.behaviorType)) {
      throw new ServiceError(`behaviorType phải thuộc một trong: ${BEHAVIOR_TYPES.join(', ')}`, 400);
    }
  }

  if (row.severity !== undefined && !SEVERITY_LEVELS.includes(row.severity)) {
    throw new ServiceError(`severity phải thuộc một trong: ${SEVERITY_LEVELS.join(', ')}`, 400);
  }

  if (row.notes !== undefined && String(row.notes).trim().length < 5) {
    throw new ServiceError('notes phải có ít nhất 5 ký tự', 400);
  }

  const category = row.observationCategory;
  if (!isUpdate && category === 'mood' && !row.moodLevel) {
    throw new ServiceError('moodLevel là bắt buộc khi loại quan sát là tâm trạng', 400);
  }

  if (!isUpdate && category === 'abnormal' && row.severity === 'normal') {
    throw new ServiceError('Biểu hiện bất thường nên chọn mức độ từ nhẹ trở lên', 400);
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
      throw new ServiceError('Cư dân không thuộc danh sách phụ trách của bạn', 403);
    }
    filter.residentId = query.residentId;
  }
  if (query.observationCategory) {
    if (!OBSERVATION_CATEGORIES.includes(query.observationCategory)) {
      throw new ServiceError(
        `observationCategory phải thuộc một trong: ${OBSERVATION_CATEGORIES.join(', ')}`,
        400
      );
    }
    filter.observationCategory = query.observationCategory;
  }
  if (query.severity) {
    if (!SEVERITY_LEVELS.includes(query.severity)) {
      throw new ServiceError(`severity phải thuộc một trong: ${SEVERITY_LEVELS.join(', ')}`, 400);
    }
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

  const category = body.observationCategory;
  if (category === 'mood' && !body.moodLevel) {
    throw new ServiceError('moodLevel là bắt buộc khi loại quan sát là tâm trạng', 400);
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
    throw new ServiceError('Chỉ người ghi nhận mới được sửa hoặc xóa bản ghi này', 403);
  }
};

const getRecord = async (userId, id) => {
  const record = await dailyBehaviorRepo.findById(id);
  if (!record) throw new ServiceError('Không tìm thấy bản ghi hành vi', 404);
  const profile = await getCaregiverProfile(userId);
  await assertResidentAssigned(profile, record.residentId?._id || record.residentId);
  return record;
};

const updateRecord = async (userId, id, body) => {
  const record = await dailyBehaviorRepo.findById(id);
  if (!record) throw new ServiceError('Không tìm thấy bản ghi hành vi', 404);
  const profile = await getCaregiverProfile(userId);
  assertAuthor(record, profile);
  validatePayload(body, true);

  const category = body.observationCategory ?? record.observationCategory;
  const moodLevel = body.moodLevel !== undefined ? body.moodLevel : record.moodLevel;
  if (category === 'mood' && !moodLevel) {
    throw new ServiceError('moodLevel là bắt buộc khi loại quan sát là tâm trạng', 400);
  }

  const update = {};
  if (body.observationCategory !== undefined) update.observationCategory = body.observationCategory;
  if (body.moodLevel !== undefined) update.moodLevel = body.moodLevel || undefined;
  if (body.behaviorType !== undefined) update.behaviorType = body.behaviorType || undefined;
  if (body.severity !== undefined) update.severity = body.severity;
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
  if (!record) throw new ServiceError('Không tìm thấy bản ghi hành vi', 404);
  const profile = await getCaregiverProfile(userId);
  assertAuthor(record, profile);
  await dailyBehaviorRepo.deleteById(id);
  return { message: 'Đã xóa bản ghi hành vi', deleted: true, id };
};

module.exports = {
  OBSERVATION_CATEGORIES,
  MOOD_LEVELS,
  BEHAVIOR_TYPES,
  SEVERITY_LEVELS,
  listAssignedResidents,
  listRecords,
  createRecord,
  getRecord,
  updateRecord,
  deleteRecord,
};

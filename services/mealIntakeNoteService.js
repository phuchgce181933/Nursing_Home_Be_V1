const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const mealIntakeNoteRepo = require('../repositories/mealIntakeNoteRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const MealPlanDay = require('../models/mealPlanDay');
const MealPlanEntry = require('../models/mealPlanEntry');
const Resident = require('../models/resident');
const mealTimeScheduleService = require('./mealTimeScheduleService');
const assignedResidentService = require('./assignedResidentService');
const { parseWorkDate, todayVN } = require('../utils/shiftTime');

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const INTAKE_STATUSES = ['full', 'partial', 'refused', 'assisted'];

const DUPLICATE_MSG =
  'Đã ghi nhận bữa này cho cư dân trong ngày. Vui lòng chỉnh sửa bản ghi hiện có.';

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

const validateIntakePayload = (body, isUpdate = false) => {
  const row = body || {};
  if (!isUpdate) {
    assertValidObjectId(row.residentId, 'residentId');
    if (!MEAL_TYPES.includes(row.mealType)) {
      throw new ServiceError(`mealType phải thuộc một trong: ${MEAL_TYPES.join(', ')}`, 400);
    }
    const workDate = parseWorkDateStrict(row.workDate);
    if (workDate > todayVN()) {
      throw new ServiceError('Không thể ghi nhận bữa ăn cho ngày trong tương lai', 400);
    }
  }

  if (row.intakeStatus !== undefined && !INTAKE_STATUSES.includes(row.intakeStatus)) {
    throw new ServiceError(`intakeStatus phải thuộc một trong: ${INTAKE_STATUSES.join(', ')}`, 400);
  }

  const status = row.intakeStatus;
  if (status === 'partial' || (isUpdate && row.portionPercent !== undefined)) {
    const pct = row.portionPercent;
    if (status === 'partial' && (pct === undefined || pct === null || pct === '')) {
      throw new ServiceError('portionPercent là bắt buộc khi tình trạng là một phần', 400);
    }
    if (pct !== undefined && pct !== null && pct !== '') {
      const num = Number(pct);
      if (Number.isNaN(num) || num < 0 || num > 100) {
        throw new ServiceError('portionPercent phải từ 0 đến 100', 400);
      }
    }
  }

  return row;
};

const findPublishedMealPlanEntry = async (residentId, workDateStr, mealType) => {
  const day = await MealPlanDay.findOne({
    status: 'published',
    workDate: {
      $gte: new Date(`${workDateStr}T00:00:00.000Z`),
      $lte: new Date(`${workDateStr}T23:59:59.999Z`),
    },
  }).sort({ publishedAt: -1 });

  if (!day) return null;

  return MealPlanEntry.findOne({
    mealPlanDayId: day._id,
    residentId,
    mealType,
  }).lean();
};

const getMealContext = async (residentId, workDateInput, mealType, userId) => {
  assertValidObjectId(residentId, 'residentId');
  if (!MEAL_TYPES.includes(mealType)) {
    throw new ServiceError(`mealType phải thuộc một trong: ${MEAL_TYPES.join(', ')}`, 400);
  }
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
      throw new ServiceError('Cư dân không thuộc danh sách phụ trách của bạn', 403);
    }
    filter.residentId = query.residentId;
  }
  if (query.mealType) {
    if (!MEAL_TYPES.includes(query.mealType)) {
      throw new ServiceError(`mealType phải thuộc một trong: ${MEAL_TYPES.join(', ')}`, 400);
    }
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

  const workDateDate = workDateToDate(workDate);
  const existing = await mealIntakeNoteRepo.findOneByUnique(
    body.residentId,
    workDateDate,
    body.mealType
  );
  if (existing) {
    throw new ServiceError(DUPLICATE_MSG, 400);
  }

  const planEntry = await findPublishedMealPlanEntry(body.residentId, workDate, body.mealType);
  if (!planEntry?.mealName) {
    throw new ServiceError(
      'Chưa có thực đơn publish cho bữa này. Không thể ghi nhận.',
      400
    );
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
    throw new ServiceError('Chỉ người ghi nhận mới được sửa hoặc xóa bản ghi này', 403);
  }
};

const getIntakeNote = async (userId, id) => {
  const note = await mealIntakeNoteRepo.findById(id);
  if (!note) throw new ServiceError('Không tìm thấy bản ghi ghi nhận bữa ăn', 404);
  const profile = await getCaregiverProfile(userId);
  await assertResidentAssigned(profile, note.residentId?._id || note.residentId);
  return note;
};

const updateIntakeNote = async (userId, id, body) => {
  const note = await mealIntakeNoteRepo.findById(id);
  if (!note) throw new ServiceError('Không tìm thấy bản ghi ghi nhận bữa ăn', 404);
  const profile = await getCaregiverProfile(userId);
  assertAuthor(note, profile);
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
        throw new ServiceError('portionPercent là bắt buộc khi tình trạng là một phần', 400);
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
  if (!note) throw new ServiceError('Không tìm thấy bản ghi ghi nhận bữa ăn', 404);
  const profile = await getCaregiverProfile(userId);
  assertAuthor(note, profile);
  await mealIntakeNoteRepo.deleteById(id);
  return { message: 'Đã xóa bản ghi ghi nhận bữa ăn', deleted: true, id };
};

module.exports = {
  MEAL_TYPES,
  INTAKE_STATUSES,
  listAssignedResidents,
  getMealContext,
  listIntakeNotes,
  createIntakeNote,
  getIntakeNote,
  updateIntakeNote,
  deleteIntakeNote,
  findPublishedMealPlanEntry,
};

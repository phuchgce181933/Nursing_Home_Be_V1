const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const specialDietDayRepo = require('../repositories/specialDietDayRepository');
const specialDietEntryRepo = require('../repositories/specialDietEntryRepository');
const { listAssignedAdmittedResidentsForUser, assertResidentsAssignedToUser } = require('./assignedResidentService');
const Resident = require('../models/resident');
const ServicePackage = require('../models/servicePackage');
const Admission = require('../models/admission');
const { parseWorkDate, todayVN, nowVN, toMinutes, buildTaskDateTime, workDateToVNString } = require('../utils/shiftTime');

const NON_TX_ERROR_PATTERNS = [
  /retryable writes/i,
  /replica set/i,
  /Transaction numbers are only allowed on a replica set member or mongos/i,
  /does not support transactions/i,
];

const DIET_TYPES = ['diabetic', 'low_sodium', 'renal', 'high_protein', 'soft_texture', 'liquid_only', 'custom'];
const VALID_ENTRY_SOURCES = ['template', 'manual'];
const DEFAULT_EFFECTIVE_TIME = '07:00';
const SPECIAL_DIET_ELIGIBLE_TIERS = ['premium', 'vip'];
const SPECIAL_DIET_INELIGIBLE_MSG =
  'Chế độ ăn đặc biệt chỉ áp dụng cho cư dân đăng ký gói VIP hoặc Cao cấp';

const SPECIAL_DIET_TEMPLATES = [
  {
    key: 'diabetic-standard',
    name: 'Tiểu đường tiêu chuẩn',
    dietType: 'diabetic',
    restrictions: ['Giảm đường tinh luyện', 'Ưu tiên tinh bột hấp thu chậm'],
    nutritionGoal: 'Ổn định đường huyết trong ngày',
  },
  {
    key: 'low-sodium-cardiac',
    name: 'Ít muối cho tim mạch',
    dietType: 'low_sodium',
    restrictions: ['Giảm muối dưới 2g/ngày', 'Tránh đồ chế biến sẵn mặn'],
    nutritionGoal: 'Hỗ trợ kiểm soát huyết áp',
  },
  {
    key: 'renal-monitoring',
    name: 'Theo dõi thận',
    dietType: 'renal',
    restrictions: ['Hạn chế kali cao', 'Hạn chế phospho', 'Kiểm soát lượng dịch'],
    nutritionGoal: 'Giảm tải chuyển hóa cho thận',
  },
];

const isNonTxErr = (err) => NON_TX_ERROR_PATTERNS.some((re) => re.test(String(err?.message || '')));

const runWithOptionalTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } catch (err) {
    if (isNonTxErr(err)) {
      console.warn('[specialDietService] Transaction unsupported, fallback to non-transaction mode:', err.message);
      return work(null);
    }
    throw err;
  } finally {
    await session.endSession();
  }
};

const parseWorkDateStrict = (workDate) => {
  const str = String(workDate || '').trim();
  try {
    parseWorkDate(str);
  } catch {
    throw new ServiceError('workDate phải đúng định dạng YYYY-MM-DD', 400);
  }
  return str;
};

const assertValidObjectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
    throw new ServiceError(`${label} không hợp lệ`, 400);
  }
};

const validateEntry = (entry, index) => {
  const row = entry || {};
  assertValidObjectId(row.residentId, `entries[${index}].residentId`);
  if (!DIET_TYPES.includes(row.dietType)) {
    throw new ServiceError(`entries[${index}].dietType phải thuộc một trong: ${DIET_TYPES.join(', ')}`, 400);
  }
  if (row.source && !VALID_ENTRY_SOURCES.includes(row.source)) {
    throw new ServiceError(`entries[${index}].source phải thuộc một trong: ${VALID_ENTRY_SOURCES.join(', ')}`, 400);
  }

  const effectiveTime = String(row.effectiveTime || DEFAULT_EFFECTIVE_TIME).trim();
  if (toMinutes(effectiveTime) === null) {
    throw new ServiceError(`entries[${index}].effectiveTime phải đúng định dạng HH:mm`, 400);
  }

  return {
    residentId: String(row.residentId),
    dietType: row.dietType,
    restrictions: Array.isArray(row.restrictions)
      ? row.restrictions.map((v) => String(v).trim()).filter(Boolean)
      : [],
    nutritionGoal: row.nutritionGoal?.trim(),
    notes: row.notes?.trim(),
    source: row.source || 'manual',
    templateKey: row.templateKey?.trim(),
    effectiveTime,
  };
};

const assertEntryTimesFromNow = (entries, workDateStr) => {
  if (workDateStr !== todayVN()) return;
  const now = nowVN();
  for (const [index, entry] of entries.entries()) {
    try {
      const effectiveAt = buildTaskDateTime(workDateStr, entry.effectiveTime);
      if (effectiveAt < now) {
        throw new ServiceError(`entries[${index}].effectiveTime phải từ thời điểm hiện tại trở đi cho ngày hôm nay`, 400);
      }
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError(`entries[${index}].effectiveTime phải đúng định dạng HH:mm`, 400);
    }
  }
};

const hydratePlan = async (day) => {
  if (!day) return null;
  const entries = await specialDietEntryRepo.findByDayId(day._id);
  return { ...day.toObject(), entries };
};

const getEligiblePackageMeta = async () => {
  const packages = await ServicePackage.find({ tier: { $in: SPECIAL_DIET_ELIGIBLE_TIERS } })
    .select('_id name')
    .lean();
  return {
    ids: packages.map((p) => p._id),
    names: packages.map((p) => p.name),
  };
};

const resolveEligibleResidentIds = async (residentIds) => {
  const ids = [...new Set((residentIds || []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return new Set();

  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
  const { ids: packageIds, names: packageNames } = await getEligiblePackageMeta();
  if (!packageIds.length && !packageNames.length) return new Set();

  const [fromAdmission, fromResident] = await Promise.all([
    packageIds.length
      ? Admission.distinct('residentId', {
          residentId: { $in: objectIds },
          status: 'checked_in',
          servicePackageId: { $in: packageIds },
        })
      : [],
    packageNames.length
      ? Resident.distinct('_id', {
          _id: { $in: objectIds },
          residencyStatus: 'admitted',
          servicePackage: { $in: packageNames },
        })
      : [],
  ]);

  return new Set([...fromAdmission, ...fromResident].map(String));
};

const assertResidentsEligibleForSpecialDiet = async (residentIds) => {
  const ids = [...new Set((residentIds || []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return;

  const eligible = await resolveEligibleResidentIds(ids);
  const ineligible = ids.filter((id) => !eligible.has(id));
  if (ineligible.length) {
    throw new ServiceError(SPECIAL_DIET_INELIGIBLE_MSG, 400);
  }
};

const getTemplates = async () => ({
  metadata: {
    version: 'v1',
    timezone: 'Asia/Ho_Chi_Minh',
    defaultEffectiveTime: DEFAULT_EFFECTIVE_TIME,
    entrySourceOptions: VALID_ENTRY_SOURCES,
  },
  dietTypes: DIET_TYPES,
  templates: SPECIAL_DIET_TEMPLATES.map((template) => ({
    ...template,
    source: 'template',
    effectiveTime: DEFAULT_EFFECTIVE_TIME,
  })),
});

const listResidentsForSpecialDiet = async (params = {}, actorUser) => {
  if (!actorUser?._id) {
    throw new ServiceError('Không xác định được người dùng', 401);
  }
  const base = await listAssignedAdmittedResidentsForUser(actorUser._id, { search: params.search });
  if (!base.data.length) return base;

  const eligibleIds = await resolveEligibleResidentIds(base.data.map((r) => r._id));
  const data = base.data.filter((r) => eligibleIds.has(String(r._id)));
  const result = { data, total: data.length };
  if (!data.length && base.total > 0) {
    result.message = SPECIAL_DIET_INELIGIBLE_MSG;
  }
  return result;
};

const createDraft = async (body, actorUserId) => {
  const workDate = parseWorkDateStrict(body.workDate);
  if (workDate < todayVN()) {
    throw new ServiceError('Không thể tạo special diet plan cho ngày trong quá khứ', 400);
  }
  const entriesInput = Array.isArray(body.entries) ? body.entries : [];
  if (!entriesInput.length) throw new ServiceError('entries là bắt buộc và không được để trống', 400);
  const entries = entriesInput.map(validateEntry);
  assertEntryTimesFromNow(entries, workDate);

  const residentIds = [...new Set(entries.map((e) => e.residentId))];
  if (residentIds.length < 1) {
    throw new ServiceError('Special diet plan phải có ít nhất 1 cư dân', 400);
  }
  await assertResidentsAssignedToUser(actorUserId, residentIds);
  await assertResidentsEligibleForSpecialDiet(residentIds);
  const residentCount = await Resident.countDocuments({ _id: { $in: residentIds } });
  if (residentCount !== residentIds.length) {
    throw new ServiceError('Có cư dân trong danh sách entries không tồn tại', 400);
  }

  let createdId;
  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    const day = await specialDietDayRepo.create(
      {
        workDate: new Date(workDate),
        title: body.title?.trim() || `Special diet plan - ${workDate}`,
        status: 'draft',
        createdBy: actorUserId,
        changeLog: [{ changedBy: actorUserId, action: 'created', details: { entries: entries.length } }],
      },
      dbOpts
    );
    createdId = day._id;
    await specialDietEntryRepo.createMany(entries.map((e) => ({ ...e, specialDietDayId: day._id })), dbOpts);
  });
  const saved = await specialDietDayRepo.findById(createdId);
  return { message: 'Tạo special diet plan nháp thành công', plan: await hydratePlan(saved) };
};

const updateDraft = async (id, body, actorUserId) => {
  const day = await specialDietDayRepo.findById(id);
  if (!day) throw new ServiceError('Không tìm thấy special diet plan', 404);
  if (day.status !== 'draft') throw new ServiceError('Chỉ có thể cập nhật special diet plan ở trạng thái nháp', 400);

  const updatePayload = {};
  if (body.workDate !== undefined) {
    const workDate = parseWorkDateStrict(body.workDate);
    if (workDate < todayVN()) throw new ServiceError('Không thể cập nhật special diet plan về ngày quá khứ', 400);
    updatePayload.workDate = new Date(workDate);
  }
  if (body.title !== undefined) updatePayload.title = body.title?.trim() || null;

  const hasEntries = Array.isArray(body.entries);
  const normalizedEntries = hasEntries ? body.entries.map(validateEntry) : null;
  if (hasEntries && !normalizedEntries.length) throw new ServiceError('entries không được để trống', 400);

  const targetWorkDateStr =
    body.workDate !== undefined
      ? parseWorkDateStrict(body.workDate)
      : workDateToVNString(day.workDate);

  if (normalizedEntries) {
    assertEntryTimesFromNow(normalizedEntries, targetWorkDateStr);
  }

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    await specialDietDayRepo.updateById(
      id,
      {
        ...updatePayload,
        $push: {
          changeLog: {
            changedBy: actorUserId,
            action: 'updated',
            details: { ...(hasEntries ? { entries: normalizedEntries.length } : {}), ...updatePayload },
          },
        },
      },
      dbOpts
    );
    if (hasEntries) {
      const residentIds = [...new Set(normalizedEntries.map((e) => e.residentId))];
      if (residentIds.length < 1) {
        throw new ServiceError('Special diet plan phải có ít nhất 1 cư dân', 400);
      }
      await assertResidentsAssignedToUser(actorUserId, residentIds);
      await assertResidentsEligibleForSpecialDiet(residentIds);
      await specialDietEntryRepo.deleteByDayId(id, dbOpts);
      await specialDietEntryRepo.createMany(normalizedEntries.map((e) => ({ ...e, specialDietDayId: id })), dbOpts);
    }
  });

  const saved = await specialDietDayRepo.findById(id);
  return { message: 'Cập nhật special diet plan nháp thành công', plan: await hydratePlan(saved) };
};

const listPlans = async (filter = {}, options = {}) => {
  const query = {};
  if (filter.workDate) {
    const workDate = parseWorkDateStrict(filter.workDate);
    query.workDate = {
      $gte: new Date(`${workDate}T00:00:00.000Z`),
      $lte: new Date(`${workDate}T23:59:59.999Z`),
    };
  }
  if (filter.status) query.status = filter.status;

  const page = parseInt(options.page, 10) || 1;
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    specialDietDayRepo.findAll(query, { skip, limit }),
    specialDietDayRepo.countAll(query),
  ]);
  const data = await Promise.all(rows.map(hydratePlan));
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const getPlan = async (id) => {
  const day = await specialDietDayRepo.findById(id);
  if (!day) throw new ServiceError('Không tìm thấy special diet plan', 404);
  return hydratePlan(day);
};

const deleteDraft = async (id) => {
  const day = await specialDietDayRepo.findById(id);
  if (!day) throw new ServiceError('Không tìm thấy special diet plan', 404);
  if (day.status !== 'draft') {
    throw new ServiceError('Chỉ có thể xóa special diet plan ở trạng thái nháp', 400);
  }

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    await specialDietEntryRepo.deleteByDayId(id, dbOpts);
    await specialDietDayRepo.deleteById(id, dbOpts);
  });

  return { message: 'Xóa special diet plan nháp thành công', deleted: true, id };
};

const publishPlan = async (id, actorUserId) => {
  const day = await specialDietDayRepo.findById(id);
  if (!day) throw new ServiceError('Không tìm thấy special diet plan', 404);
  if (day.status === 'published') {
    return { message: 'Special diet plan đã publish trước đó', idempotent: true, plan: await hydratePlan(day) };
  }
  if (day.status !== 'draft') throw new ServiceError(`Không thể publish special diet plan ở trạng thái ${day.status}`, 400);

  const workDate = workDateToVNString(day.workDate);
  if (workDate < todayVN()) throw new ServiceError('Không thể publish special diet plan cho ngày trong quá khứ', 400);

  const entries = await specialDietEntryRepo.findByDayId(id);
  if (!entries.length) throw new ServiceError('Không thể publish special diet plan rỗng', 400);
  assertEntryTimesFromNow(entries, workDate);

  const residentIds = [...new Set(entries.map((e) => String(e.residentId?._id || e.residentId)))];
  if (residentIds.length < 1) {
    throw new ServiceError('Special diet plan phải có ít nhất 1 cư dân trước khi publish', 400);
  }
  await assertResidentsAssignedToUser(actorUserId, residentIds);
  await assertResidentsEligibleForSpecialDiet(residentIds);

  await runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    await specialDietDayRepo.updateById(
      id,
      {
        status: 'published',
        publishedBy: actorUserId,
        publishedAt: new Date(),
        $push: { changeLog: { changedBy: actorUserId, action: 'published', details: { entries: entries.length } } },
      },
      dbOpts
    );
  });

  const saved = await specialDietDayRepo.findById(id);
  return { message: 'Publish special diet plan thành công', plan: await hydratePlan(saved) };
};

module.exports = {
  getTemplates,
  listResidentsForSpecialDiet,
  createDraft,
  updateDraft,
  listPlans,
  getPlan,
  deleteDraft,
  publishPlan,
};

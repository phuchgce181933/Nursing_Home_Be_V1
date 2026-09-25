const { Types } = require('mongoose');
const auditLogRepo = require('../repositories/auditLogRepository');
const StaffProfile = require('../models/staffProfile');
const User = require('../models/user');
const Resident = require('../models/resident');
const ServiceError = require('./serviceError');

const enrichMealIntakeActorNames = async (logs) => {
  const caregiverRecordLogs = logs.filter((log) =>
    ['mealIntake', 'hygieneActivity', 'dailyBehavior'].includes(log.module) ||
    ['mealIntake', 'hygieneActivity', 'dailyBehavior'].includes(log.businessModule)
  );
  const staffIds = caregiverRecordLogs
    .flatMap((log) => [log.beforeData?.recordedByStaffId, log.afterData?.recordedByStaffId])
    .map((value) => (value && typeof value === 'object' ? value._id : value))
    .filter((value) => value && Types.ObjectId.isValid(String(value)))
    .map(String);

  if (!staffIds.length) return logs;

  const profiles = await StaffProfile.find({ _id: { $in: [...new Set(staffIds)] } })
    .populate('userId', 'fullName')
    .select('_id userId')
    .lean();
  const namesByStaffId = new Map(
    profiles
      .filter((profile) => profile.userId?.fullName)
      .map((profile) => [String(profile._id), profile.userId.fullName])
  );

  caregiverRecordLogs.forEach((log) => {
    const values = [log.beforeData?.recordedByStaffId, log.afterData?.recordedByStaffId];
    const staffId = values
      .map((value) => (value && typeof value === 'object' ? value._id : value))
      .find((value) => value && namesByStaffId.has(String(value)));
    const name = staffId ? namesByStaffId.get(String(staffId)) : null;
    if (name) log.metadata = { ...(log.metadata || {}), recordedByName: name };
  });

  return logs;
};

const enrichMealPlanActorNames = async (logs) => {
  const mealPlanLogs = logs.filter((log) =>
    ['mealPlan', 'mealTimeSchedule'].includes(log.module) ||
    ['mealPlan', 'mealTimeSchedule'].includes(log.businessModule)
  );
  const actorIds = mealPlanLogs
    .map((log) => log.actorUserId)
    .filter((value) => value && Types.ObjectId.isValid(String(value)))
    .map(String);
  if (!actorIds.length) return logs;

  const users = await User.find({ _id: { $in: [...new Set(actorIds)] } }).select('_id fullName').lean();
  const namesByUserId = new Map(users.map((user) => [String(user._id), user.fullName]));
  const scheduleLogs = mealPlanLogs.filter((log) => log.module === 'mealTimeSchedule' || log.businessModule === 'mealTimeSchedule');
  const residentIds = scheduleLogs
    .flatMap((log) => [log.beforeData?.entries, log.afterData?.entries])
    .filter(Array.isArray)
    .flat()
    .map((entry) => entry?.residentId && typeof entry.residentId === 'object' ? entry.residentId._id : entry?.residentId)
    .filter((value) => value && Types.ObjectId.isValid(String(value)))
    .map(String);
  const residents = residentIds.length
    ? await Resident.find({ _id: { $in: [...new Set(residentIds)] } }).select('_id fullName').lean()
    : [];
  const namesByResidentId = new Map(residents.map((resident) => [String(resident._id), resident.fullName]));
  mealPlanLogs.forEach((log) => {
    const actorId = String(log.actorUserId);
    const name = namesByUserId.get(actorId);
    if (name && (!log.performedBy || log.performedBy === actorId)) log.performedBy = name;
    if (log.module === 'mealTimeSchedule' || log.businessModule === 'mealTimeSchedule') {
      const entries = log.afterData?.entries || log.beforeData?.entries || [];
      const entriesSummary = entries.map((entry) => {
        const residentId = entry?.residentId && typeof entry.residentId === 'object' ? entry.residentId._id : entry?.residentId;
        const residentName = namesByResidentId.get(String(residentId)) || 'Cư dân';
        return `${residentName}: Sáng ${entry?.breakfastTime || '—'}, Trưa ${entry?.lunchTime || '—'}, Tối ${entry?.dinnerTime || '—'}`;
      });
      if (entriesSummary.length) log.metadata = { ...(log.metadata || {}), entriesSummary };
    }
  });
  return logs;
};

const buildAuditLogFilter = (query = {}) => {
  const filter = {};

  if (query.actorUserId && Types.ObjectId.isValid(query.actorUserId)) {
    filter.actorUserId = query.actorUserId;
  }

  if (query.actorRole) {
    filter.actorRole = String(query.actorRole).trim();
  }

  if (query.performedByRole) {
    filter.performedByRole = String(query.performedByRole).trim();
  }

  if (query.action) {
    filter.action = { $regex: String(query.action).trim(), $options: 'i' };
  }

  if (query.displayAction) {
    filter.displayAction = { $regex: String(query.displayAction).trim(), $options: 'i' };
  }

  if (query.module) {
    filter.businessModule = String(query.module).trim();
  }

  if (query.businessModule) {
    filter.businessModule = String(query.businessModule).trim();
  }

  if (query.targetEntityType) {
    filter.targetEntityType = String(query.targetEntityType).trim();
  }

  if (query.targetName) {
    filter.targetName = { $regex: String(query.targetName).trim(), $options: 'i' };
  }

  if (query.performedBy) {
    filter.performedBy = { $regex: String(query.performedBy).trim(), $options: 'i' };
  }

  if (query.description) {
    filter.description = { $regex: String(query.description).trim(), $options: 'i' };
  }

  if (query.targetEntityId && Types.ObjectId.isValid(query.targetEntityId)) {
    filter.targetEntityId = query.targetEntityId;
  }

  if (query.fromDate || query.toDate) {
    filter.createdAt = {};
    if (query.fromDate) {
      const fromDate = new Date(query.fromDate);
      if (Number.isNaN(fromDate.getTime())) {
        throw new ServiceError('fromDate không hợp lệ', 400);
      }
      filter.createdAt.$gte = fromDate;
    }
    if (query.toDate) {
      const toDate = new Date(query.toDate);
      if (Number.isNaN(toDate.getTime())) {
        throw new ServiceError('toDate không hợp lệ', 400);
      }
      filter.createdAt.$lte = toDate;
    }
  }

  if (query.hideTechnical === 'true' || query.hideTechnical === true) {
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { module: { $ne: 'api' } },
        { action: { $not: /^REQUEST_/ } },
      ],
    });
  }

  if (query.ipAddress) {
    filter.ipAddress = String(query.ipAddress).trim();
  }

  if (query.userAgent) {
    filter.userAgent = { $regex: String(query.userAgent).trim(), $options: 'i' };
  }

  if (query.search) {
    const search = String(query.search).trim();
    filter.$or = [
      { action: { $regex: search, $options: 'i' } },
      { displayAction: { $regex: search, $options: 'i' } },
      { businessModule: { $regex: search, $options: 'i' } },
      { module: { $regex: search, $options: 'i' } },
      { performedBy: { $regex: search, $options: 'i' } },
      { performedByRole: { $regex: search, $options: 'i' } },
      { targetEntityType: { $regex: search, $options: 'i' } },
      { targetName: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  return filter;
};

const listAuditLogs = async (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;
  const sortBy = ['createdAt', 'displayAction', 'businessModule', 'action', 'module', 'actorRole'].includes(query.sortBy)
    ? query.sortBy
    : 'createdAt';
  const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

  const filter = buildAuditLogFilter(query);
  const [rawData, total] = await Promise.all([
    auditLogRepo.findByFilterLean(filter, { sort: { [sortBy]: sortOrder }, skip, limit }),
    auditLogRepo.countByFilter(filter),
  ]);
  const data = await enrichMealPlanActorNames(await enrichMealIntakeActorNames(rawData));

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
};

const getAuditLogFilters = async (query = {}) => {
  const filter = {};
  if (query.hideTechnical === 'true' || query.hideTechnical === true) {
    filter.$and = [{
      $or: [
        { module: { $ne: 'api' } },
        { action: { $not: /^REQUEST_/ } },
      ],
    }];
  }

  const [actions, businessModules, roles] = await Promise.all([
    auditLogRepo.distinct('action', filter),
    auditLogRepo.distinct('businessModule', filter),
    auditLogRepo.distinct('performedByRole', filter),
  ]);

  return {
    actions: actions.sort(),
    businessModules: businessModules.sort(),
    roles: roles.sort(),
  };
};

const getAuditLogById = async (id) => {
  if (!Types.ObjectId.isValid(id)) {
    throw new ServiceError('ID nhật ký kiểm tra không hợp lệ', 400);
  }

  const auditLog = await auditLogRepo.findByIdLean(id);
  if (!auditLog) {
    throw new ServiceError('Không tìm thấy bản ghi nhật ký kiểm tra', 404);
  }

  const [enrichedLog] = await enrichMealPlanActorNames(await enrichMealIntakeActorNames([auditLog]));
  return enrichedLog;
};

module.exports = {
  listAuditLogs,
  getAuditLogFilters,
  getAuditLogById,
};

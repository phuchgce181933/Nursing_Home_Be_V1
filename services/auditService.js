const { Types } = require('mongoose');
const AuditLog = require('../models/auditLog');
const ServiceError = require('./serviceError');

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
  const [data, total] = await Promise.all([
    AuditLog.find(filter).sort({ [sortBy]: sortOrder }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

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
    AuditLog.distinct('action', filter),
    AuditLog.distinct('businessModule', filter),
    AuditLog.distinct('performedByRole', filter),
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

  const auditLog = await AuditLog.findById(id).lean();
  if (!auditLog) {
    throw new ServiceError('Không tìm thấy bản ghi nhật ký kiểm tra', 404);
  }

  return auditLog;
};

module.exports = {
  listAuditLogs,
  getAuditLogFilters,
  getAuditLogById,
};

// Ghi lịch sử hoạt động hệ thống (Audit Log)
const AuditLog = require('../models/auditLog');

const humanizeAction = (value) => {
  if (!value) return undefined;
  return String(value)
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const buildRequestContext = (req) => {
  if (!req) return {};
  return {
    ipAddress: req.ip,
    userAgent: req.headers?.['user-agent'],
    requestMethod: req.method,
    requestUrl: req.originalUrl || req.url,
    requestQuery: req.query && Object.keys(req.query).length ? req.query : undefined,
    requestParams: req.params && Object.keys(req.params).length ? req.params : undefined,
  };
};

const buildBusinessContext = ({
  action,
  module,
  displayAction,
  description,
  performedBy,
  performedByRole,
  businessModule,
  targetEntityType,
  targetEntityId,
  targetName,
  actorRole,
  actorUserId,
  req,
}) => ({
  displayAction: displayAction || humanizeAction(action),
  description,
  performedBy: performedBy || req?.user?.fullName || (actorUserId ? String(actorUserId) : undefined),
  performedByRole: performedByRole || actorRole || req?.user?.role,
  businessModule: businessModule || module,
  targetName:
    targetName ||
    (targetEntityType && targetEntityId
      ? `${targetEntityType} ${targetEntityId}`
      : targetEntityType || undefined),
});

const createAuditLog = async ({
  actorUserId,
  actorRole,
  action,
  module,
  targetEntityType,
  targetEntityId,
  beforeData,
  afterData,
  metadata,
  displayAction,
  description,
  performedBy,
  performedByRole,
  businessModule,
  targetName,
  req,
  statusCode,
}) => {
  if (!action || !module) {
    throw new Error('AuditLog requires action and module');
  }

  try {
    await AuditLog.create({
      actorUserId,
      actorRole,
      action,
      displayAction,
      businessModule,
      module,
      performedBy,
      performedByRole,
      targetEntityType,
      targetEntityId,
      targetName,
      description,
      beforeData,
      afterData,
      metadata,
      statusCode,
      ...buildRequestContext(req),
      ...buildBusinessContext({
        action,
        module,
        displayAction,
        description,
        performedBy,
        performedByRole,
        businessModule,
        targetEntityType,
        targetEntityId,
        targetName,
        actorRole,
        actorUserId,
        req,
      }),
    });
  } catch (err) {
    console.error('AuditLog write failed:', err.message);
  }
};

const logCreate = async (params) => createAuditLog({ ...params, action: params.action || 'CREATE' });
const logUpdate = async (params) => createAuditLog({ ...params, action: params.action || 'UPDATE' });
const logDelete = async (params) => createAuditLog({ ...params, action: params.action || 'DELETE' });
const logAction = async (params) => createAuditLog(params);

module.exports = { createAuditLog, logCreate, logUpdate, logDelete, logAction };

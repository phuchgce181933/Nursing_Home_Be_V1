const AuditLog = require('../models/auditLog');

const createAuditLog = async ({ actorUserId, actorRole, action, module, targetEntityType, targetEntityId, beforeData, afterData, metadata, req }) => {
  try {
    await AuditLog.create({
      actorUserId,
      actorRole,
      action,
      module,
      targetEntityType,
      targetEntityId,
      beforeData,
      afterData,
      metadata,
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });
  } catch (err) {
    console.error('AuditLog write failed:', err.message);
  }
};

module.exports = { createAuditLog };

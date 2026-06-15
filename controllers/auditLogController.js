const auditService = require('../services/auditService');

const listAuditLogs = async (req, res) => {
  try {
    const result = await auditService.listAuditLogs(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getAuditLogFilters = async (req, res) => {
  try {
    const result = await auditService.getAuditLogFilters(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getAuditLog = async (req, res) => {
  try {
    const result = await auditService.getAuditLogById(req.params.logId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  listAuditLogs,
  getAuditLogFilters,
  getAuditLog,
};

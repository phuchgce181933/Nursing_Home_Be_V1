const { createAuditLog } = require('../utils/auditLog');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

module.exports = (req, res, next) => {
  if (!MUTATING_METHODS.has(req.method)) {
    return next();
  }

  const cleanup = () => {
    res.removeListener('finish', onFinish);
    res.removeListener('close', onClose);
  };

  const onFinish = async () => {
    cleanup();
    if (!req.user) return;
    try {
      await createAuditLog({
        actorUserId: req.user._id,
        actorRole: req.user.role,
        action: `REQUEST_${req.method}`,
        displayAction: `API request ${req.method}`,
        businessModule: 'API',
        module: 'api',
        description: `HTTP ${req.method} ${req.originalUrl || req.url} returned ${res.statusCode}`,
        targetEntityType: null,
        targetEntityId: null,
        metadata: {
          route: req.originalUrl || req.url,
          statusCode: res.statusCode,
        },
        req,
        statusCode: res.statusCode,
      });
    } catch (err) {
      console.error('Audit logger failed:', err.message);
    }
  };

  const onClose = () => {
    cleanup();
  };

  res.on('finish', onFinish);
  res.on('close', onClose);
  next();
};

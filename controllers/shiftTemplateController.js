const svc = require('../services/shiftTemplateService');

const respond = (res, promise) =>
  promise
    .then((data) => res.json({ success: true, data }))
    .catch((err) => {
      console.error('[ShiftTemplate] Error:', err);
      res.status(err.status || 500).json({ success: false, message: err.message });
    });

const listTemplates = (req, res) => respond(res, svc.listTemplates(req.query));
const getTemplate = (req, res) => respond(res, svc.getTemplate(req.params.id));

module.exports = { listTemplates, getTemplate };

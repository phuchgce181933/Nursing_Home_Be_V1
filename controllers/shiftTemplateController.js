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
const createTemplate = (req, res) => respond(res, svc.createTemplate(req.body, req.user._id));
const updateTemplate = (req, res) =>
  svc.updateTemplate(req.params.id, req.body, req.user._id).then((result) => res.json({ success: true, ...result })).catch((err) => res.status(err.status || 500).json({ success: false, message: err.message }));
const updateTemplateStatus = (req, res) => respond(res, svc.updateTemplateStatus(req.params.id, req.body.status));
const deleteTemplate = (req, res) => respond(res, svc.deleteTemplate(req.params.id));

module.exports = { listTemplates, getTemplate, createTemplate, updateTemplate, updateTemplateStatus, deleteTemplate };

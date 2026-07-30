const incidentService = require('../services/incidentService');
const multer = require('multer');

const resolutionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
});

const createIncident = async (req, res) => {
  try {
    const result = await incidentService.createIncident(req.user, req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listIncidents = async (req, res) => {
  try {
    const result = await incidentService.listIncidents(req.user, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getIncident = async (req, res) => {
  try {
    const result = await incidentService.getIncident(req.user, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const updateIncidentStatus = async (req, res) => {
  try {
    const result = await incidentService.updateIncidentStatus(req.user, req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const reopenIncident = async (req, res) => {
  try {
    const result = await incidentService.reopenIncident(req.user, req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const exportIncidents = async (req, res) => {
  try {
    const { csv, fileName } = await incidentService.exportIncidents(req.user, req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const assignHandlers = async (req, res) => {
  try {
    const result = await incidentService.assignHandlers(req.user, req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getAssignmentConflicts = async (req, res) => {
  try {
    const result = await incidentService.getAssignmentConflicts(req.user, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const updateIncidentResolution = async (req, res) => {
  const handler = resolutionUpload.array('resolutionFiles', 10);
  handler(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    try {
      const payload = req.body || {};
      const files = req.files || [];
      const result = await incidentService.updateIncidentResolution(req.user, req.params.id, payload, files);
      res.json(result);
    } catch (error) {
      res.status(error.statusCode || 500).json({ message: error.message });
    }
  });
};

module.exports = {
  createIncident,
  listIncidents,
  getIncident,
  updateIncidentStatus,
  reopenIncident,
  assignHandlers,
  exportIncidents,
  updateIncidentResolution,
  getAssignmentConflicts,
};

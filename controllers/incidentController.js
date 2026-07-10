const incidentService = require('../services/incidentService');

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

module.exports = {
  createIncident,
  listIncidents,
  getIncident,
  updateIncidentStatus,
  assignHandlers,
  exportIncidents,
};

const visitService = require('../services/residentVisitService');

const createVisit = async (req, res) => {
  try {
    const result = await visitService.createVisit(req.user, req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listFamilyVisits = async (req, res) => {
  try {
    const result = await visitService.listFamilyVisits(req.user, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const cancelVisit = async (req, res) => {
  try {
    const result = await visitService.cancelVisit(req.user, req.params.visitId, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listVisits = async (req, res) => {
  try {
    const result = await visitService.listVisits(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const approveVisit = async (req, res) => {
  try {
    const result = await visitService.approveVisit(req.user, req.params.visitId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const rejectVisit = async (req, res) => {
  try {
    const result = await visitService.rejectVisit(req.user, req.params.visitId, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  createVisit,
  listFamilyVisits,
  cancelVisit,
  listVisits,
  approveVisit,
  rejectVisit,
};

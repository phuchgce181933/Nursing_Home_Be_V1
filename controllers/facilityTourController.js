const facilityTourService = require('../services/facilityTourService');

const scheduleTour = async (req, res) => {
  try {
    const result = await facilityTourService.scheduleTour(req.user, req.body, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const listTourHistory = async (req, res) => {
  try {
    const result = await facilityTourService.listTourHistory(req.user, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const cancelTour = async (req, res) => {
  try {
    const result = await facilityTourService.cancelTour(req.user, req.params.tourId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

// ── Admin handlers ──────────────────────────────────────────────────
const adminListTours = async (req, res) => {
  try {
    const result = await facilityTourService.adminListTours(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const adminGetTour = async (req, res) => {
  try {
    const result = await facilityTourService.adminGetTour(req.params.tourId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const approveTour = async (req, res) => {
  try {
    const result = await facilityTourService.approveTour(req.user, req.params.tourId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const completeTour = async (req, res) => {
  try {
    const result = await facilityTourService.completeTour(req.user, req.params.tourId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

const rejectTour = async (req, res) => {
  try {
    const result = await facilityTourService.rejectTour(req.user, req.params.tourId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message, errorCode: err.errorCode });
  }
};

module.exports = { scheduleTour, listTourHistory, cancelTour, adminListTours, adminGetTour, approveTour, completeTour, rejectTour };

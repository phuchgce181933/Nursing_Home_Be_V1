const familyPortalService = require('../services/familyPortalService');

const getResidents = async (req, res) => {
  try {
    const result = await familyPortalService.getResidents(req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getResident = async (req, res) => {
  try {
    const result = await familyPortalService.getResident(req.user, req.params.residentId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getVitals = async (req, res) => {
  try {
    const result = await familyPortalService.getVitals(req.user, req.params.residentId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getHealthHistory = async (req, res) => {
  try {
    const result = await familyPortalService.getHealthHistory(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getHealthChart = async (req, res) => {
  try {
    const result = await familyPortalService.getHealthChart(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getCareNotes = async (req, res) => {
  try {
    const result = await familyPortalService.getCareNotes(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getMedications = async (req, res) => {
  try {
    const result = await familyPortalService.getMedications(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getPrescriptions = async (req, res) => {
  try {
    const result = await familyPortalService.getPrescriptions(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getActivities = async (req, res) => {
  try {
    const result = await familyPortalService.getActivities(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getCareAppointments = async (req, res) => {
  try {
    const result = await familyPortalService.getCareAppointments(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getHealthReport = async (req, res) => {
  try {
    const result = await familyPortalService.getHealthReport(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getDailyActivities = async (req, res) => {
  try {
    const result = await familyPortalService.getDailyActivities(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getCareSchedule = async (req, res) => {
  try {
    const result = await familyPortalService.getCareSchedule(req.user, req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const downloadReport = async (req, res) => {
  try {
    const { csv, filename } = await familyPortalService.downloadReport(req.user, req.params.residentId, req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  getResidents,
  getResident,
  getVitals,
  getHealthHistory,
  getHealthChart,
  getCareNotes,
  getMedications,
  getPrescriptions,
  getActivities,
  getCareAppointments,
  getHealthReport,
  getDailyActivities,
  getCareSchedule,
  downloadReport,
};

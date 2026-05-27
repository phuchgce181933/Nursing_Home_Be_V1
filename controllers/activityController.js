const activityService = require('../services/activityService');

const createActivity = async (req, res) => {
  try {
    const result = await activityService.createActivity(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listActivities = async (req, res) => {
  try {
    const result = await activityService.listActivities(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getActivity = async (req, res) => {
  try {
    const result = await activityService.getActivityById(req.params.activityId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const updateActivity = async (req, res) => {
  try {
    const result = await activityService.updateActivity(req.params.activityId, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const deleteActivity = async (req, res) => {
  try {
    const result = await activityService.deleteActivity(req.params.activityId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const updateActivityStatus = async (req, res) => {
  try {
    const result = await activityService.updateActivity(req.params.activityId, { status: req.body.status });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const setParticipantList = async (req, res) => {
  try {
    const result = await activityService.setParticipantList(req.params.activityId, req.body.participantResidentIds);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const registerResident = async (req, res) => {
  try {
    const result = await activityService.registerResident(req.params.activityId, req.body.residentId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const recordParticipationResult = async (req, res) => {
  try {
    const result = await activityService.recordParticipationResult(req.params.activityId, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getActivityStatistics = async (req, res) => {
  try {
    const result = await activityService.getActivityStatistics(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getActivityStatisticsById = async (req, res) => {
  try {
    const result = await activityService.getActivityStatisticsById(req.params.activityId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  createActivity,
  listActivities,
  getActivity,
  updateActivity,
  deleteActivity,
  updateActivityStatus,
  setParticipantList,
  registerResident,
  recordParticipationResult,
  getActivityStatistics,
  getActivityStatisticsById,
};

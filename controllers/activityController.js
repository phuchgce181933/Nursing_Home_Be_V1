const activityService = require('../services/activityService');

const createActivity = async (req, res) => {
  try {
    const result = await activityService.createActivity(req.body, req);
    res.status(201).json(result);
  } catch (err) {
    // Surface extra context in dev so 500s aren't silent "Request body is required" placeholders.
    console.error('[createActivity] body=%j', req.body);
    console.error('[createActivity] err=%s', err.stack || err);
    const payload = { message: err.message };
    if (process.env.NODE_ENV !== 'production') {
      payload.stack = err.stack;
    }
    res.status(err.statusCode || 500).json(payload);
  }
};

const listActivities = async (req, res) => {
  try {
    const query = { ...req.query };
    // Nurses can only see activities where they are assigned as organizers
    if (req.user) {
      const userRole = String(req.user.role || '').toLowerCase();
      const isStaffLikeRole = userRole.includes('nurse')
        || userRole.includes('y tá')
        || userRole.includes('điều dưỡng')
        || userRole.includes('caregiver')
        || userRole.includes('hộ lý')
        || userRole.includes('doctor')
        || userRole.includes('bác sĩ');
      if (isStaffLikeRole) {
        query.organizerStaffIds = req.user._id.toString();
      }
    }
    const result = await activityService.listActivities(query);
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
    const result = await activityService.updateActivity(req.params.activityId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const deleteActivity = async (req, res) => {
  try {
    const result = await activityService.deleteActivity(req.params.activityId, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const bulkDeleteActivities = async (req, res) => {
  try {
    const result = await activityService.bulkDeleteActivities(req.query, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const bulkUpdateActivityStatus = async (req, res) => {
  try {
    const result = await activityService.bulkUpdateActivityStatus(req.query, req.body?.status, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const bulkUpdateActivities = async (req, res) => {
  try {
    const result = await activityService.bulkUpdateActivities(req.params.activityId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const updateActivityStatus = async (req, res) => {
  try {
    const result = await activityService.updateActivity(req.params.activityId, { status: req.body.status }, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const setParticipantList = async (req, res) => {
  try {
    const result = await activityService.setParticipantList(req.params.activityId, req.body.participantResidentIds, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const registerResident = async (req, res) => {
  try {
    const result = await activityService.registerResident(req.params.activityId, req.body.residentId, req.user, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const unregisterResident = async (req, res) => {
  try {
    const result = await activityService.unregisterResident(req.params.activityId, req.body.residentId, req.user, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const recordParticipationResult = async (req, res) => {
  try {
    const result = await activityService.recordParticipationResult(req.params.activityId, req.body, req);
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
  bulkDeleteActivities,
  bulkUpdateActivityStatus,
  bulkUpdateActivities,
  updateActivityStatus,
  setParticipantList,
  registerResident,
  unregisterResident,
  recordParticipationResult,
  getActivityStatistics,
  getActivityStatisticsById,
};

const medAdminService = require('../services/medicationAdministrationService');

const sendError = (res, err) =>
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message,
    ...(err.todayCount !== undefined ? { todayCount: err.todayCount, maxDailyDoses: err.maxDailyDoses } : {}),
  });

const getAvailableMedications = async (req, res) => {
  try {
    const result = await medAdminService.getAvailableMedications({ query: req.query });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return sendError(res, err);
  }
};

const getCurrentMedications = async (req, res) => {
  try {
    const data = await medAdminService.getCurrentMedications({ query: req.query, user: req.user });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const setMedicationSchedule = async (req, res) => {
  try {
    const result = await medAdminService.setMedicationSchedule({ body: req.body, user: req.user, req });
    if (result.noChanges) {
      return res.status(200).json({ success: true, message: 'Không có thay đổi lịch nào được phát hiện', data: result.data });
    }
    return res.status(200).json({ success: true, message: result.message, data: result.data });
  } catch (err) {
    return sendError(res, err);
  }
};

const getDailySchedule = async (req, res) => {
  try {
    const result = await medAdminService.getDailySchedule({ query: req.query, user: req.user });
    return res.status(200).json({ success: true, date: result.date, data: result.data });
  } catch (err) {
    return sendError(res, err);
  }
};

const getSchedules = async (req, res) => {
  try {
    const data = await medAdminService.getSchedules({ query: req.query, user: req.user });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const markTaken = async (req, res) => {
  try {
    const data = await medAdminService.markTaken({ id: req.params.id, body: req.body, user: req.user, req });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const markMissed = async (req, res) => {
  try {
    const data = await medAdminService.markMissed({ id: req.params.id, body: req.body, user: req.user, req });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const markRefused = async (req, res) => {
  try {
    const data = await medAdminService.markRefused({ id: req.params.id, body: req.body, user: req.user, req });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const markHeld = async (req, res) => {
  try {
    const data = await medAdminService.markHeld({ id: req.params.id, body: req.body, user: req.user, req });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const markNotAvailable = async (req, res) => {
  try {
    const data = await medAdminService.markNotAvailable({ id: req.params.id, body: req.body, user: req.user, req });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const administerPRN = async (req, res) => {
  try {
    const data = await medAdminService.administerPRN({ body: req.body, user: req.user, req });
    return res.status(201).json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const getHistory = async (req, res) => {
  try {
    const data = await medAdminService.getHistory({ query: req.query, user: req.user });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

module.exports = {
  getAvailableMedications,
  getCurrentMedications,
  setMedicationSchedule,
  getDailySchedule,
  getSchedules,
  markTaken,
  markMissed,
  markRefused,
  markHeld,
  markNotAvailable,
  administerPRN,
  getHistory,
};

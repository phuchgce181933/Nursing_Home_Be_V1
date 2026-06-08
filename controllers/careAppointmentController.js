const careAppointmentService = require('../services/careAppointmentService');

const createAppointment = async (req, res) => {
  try {
    const result = await careAppointmentService.createAppointment(req.user, req.body, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listAppointments = async (req, res) => {
  try {
    const result = await careAppointmentService.listAppointments(req.user, req.staffProfile, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getMyAppointments = async (req, res) => {
  try {
    const result = await careAppointmentService.getMyAppointments(req.user, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getDailySchedule = async (req, res) => {
  try {
    const result = await careAppointmentService.getDailySchedule(req.user, req.staffProfile, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getWeeklySchedule = async (req, res) => {
  try {
    const result = await careAppointmentService.getWeeklySchedule(req.user, req.staffProfile, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getAppointment = async (req, res) => {
  try {
    const result = await careAppointmentService.getAppointment(req.user, req.staffProfile, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const updateAppointment = async (req, res) => {
  try {
    const result = await careAppointmentService.updateAppointment(req.user, req.params.id, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const deleteAppointment = async (req, res) => {
  try {
    const result = await careAppointmentService.deleteAppointment(req.user, req.params.id, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const updateStatus = async (req, res) => {
  try {
    const result = await careAppointmentService.updateStatus(req.user, req.params.id, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const assignDoctor = async (req, res) => {
  try {
    const result = await careAppointmentService.assignDoctor(req.user, req.params.id, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const assignNurse = async (req, res) => {
  try {
    const result = await careAppointmentService.assignNurse(req.user, req.params.id, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const sendReminder = async (req, res) => {
  try {
    const result = await careAppointmentService.sendReminder(req.user, req.params.id, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getAvailableStaff = async (req, res) => {
  try {
    const result = await careAppointmentService.getAvailableStaffForAppointment(req.user, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  createAppointment,
  listAppointments,
  getMyAppointments,
  getDailySchedule,
  getWeeklySchedule,
  getAppointment,
  updateAppointment,
  deleteAppointment,
  updateStatus,
  assignDoctor,
  assignNurse,
  sendReminder,
  getAvailableStaff,
};

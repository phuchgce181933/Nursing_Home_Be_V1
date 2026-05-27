const leaveRequestService = require('../services/leaveRequestService');

const submitLeaveRequest = async (req, res) => {
  try {
    const result = await leaveRequestService.submitLeaveRequest(req.user, req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listLeaveRequests = async (req, res) => {
  try {
    const result = await leaveRequestService.listLeaveRequests(req.user, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getLeaveRequest = async (req, res) => {
  try {
    const result = await leaveRequestService.getLeaveRequest(req.user, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const approveLeaveRequest = async (req, res) => {
  try {
    const result = await leaveRequestService.approveLeaveRequest(req.user, req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const rejectLeaveRequest = async (req, res) => {
  try {
    const result = await leaveRequestService.rejectLeaveRequest(req.user, req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const cancelLeaveRequest = async (req, res) => {
  try {
    const result = await leaveRequestService.cancelLeaveRequest(req.user, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  submitLeaveRequest,
  listLeaveRequests,
  getLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequest,
};

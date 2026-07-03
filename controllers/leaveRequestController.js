const leaveRequestService = require('../services/leaveRequestService');
const { sendApiError } = require('../utils/apiErrorResponse');

const submitLeaveRequest = async (req, res) => {
  try {
    const result = await leaveRequestService.submitLeaveRequest(req.user, req.body);
    res.status(201).json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const listLeaveRequests = async (req, res) => {
  try {
    const result = await leaveRequestService.listLeaveRequests(req.user, req.query);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const getLeaveRequest = async (req, res) => {
  try {
    const result = await leaveRequestService.getLeaveRequest(req.user, req.params.id);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const getReplacementCandidates = async (req, res) => {
  try {
    const result = await leaveRequestService.getReplacementCandidates(req.user, req.params.id);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const approveLeaveRequest = async (req, res) => {
  try {
    const result = await leaveRequestService.approveLeaveRequest(req.user, req.params.id, req.body);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const rejectLeaveRequest = async (req, res) => {
  try {
    const result = await leaveRequestService.rejectLeaveRequest(req.user, req.params.id, req.body);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const cancelLeaveRequest = async (req, res) => {
  try {
    const result = await leaveRequestService.cancelLeaveRequest(req.user, req.params.id);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

module.exports = {
  submitLeaveRequest,
  listLeaveRequests,
  getLeaveRequest,
  getReplacementCandidates,
  approveLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequest,
};

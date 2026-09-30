const consultationRequestService = require('../services/consultationRequestService');
const { sendApiError } = require('../utils/apiErrorResponse');

const submitConsultationRequest = async (req, res) => {
  try {
    const result = await consultationRequestService.submitConsultationRequest(req.body, req);
    res.status(201).json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const listConsultationRequests = async (req, res) => {
  try {
    const result = await consultationRequestService.listConsultationRequests(req.query);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const getConsultationRequest = async (req, res) => {
  try {
    const result = await consultationRequestService.getConsultationRequest(req.params.requestId);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const updateConsultationRequest = async (req, res) => {
  try {
    const result = await consultationRequestService.updateConsultationRequest(req.params.requestId, req.body, req);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

module.exports = {
  submitConsultationRequest,
  listConsultationRequests,
  getConsultationRequest,
  updateConsultationRequest,
};

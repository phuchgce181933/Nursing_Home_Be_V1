const admissionService = require('../services/admissionService');
const { normalizeAdmissionBody } = require('../utils/normalizeAdmissionBody');

const submitAdmissionRequest = async (req, res) => {
  try {
    const payload = normalizeAdmissionBody(req.body);
    const result = await admissionService.submitAdmissionRequest(req.user, payload, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listAdmissionRequests = async (req, res) => {
  try {
    const result = await admissionService.listAdmissionHistory(req.user, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getAdmissionRequest = async (req, res) => {
  try {
    const result = await admissionService.getAdmissionRequest(req.user, req.params.admissionId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const cancelAdmissionRequest = async (req, res) => {
  try {
    const result = await admissionService.cancelAdmissionRequest(
      req.user,
      req.params.admissionId,
      req.body,
      req
    );
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  submitAdmissionRequest,
  listAdmissionRequests,
  getAdmissionRequest,
  cancelAdmissionRequest,
};

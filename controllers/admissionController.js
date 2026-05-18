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

module.exports = { submitAdmissionRequest };

const supportRequestService = require('../services/supportRequestService');

const submitSupportRequest = async (req, res) => {
  try {
    const payload = req.body;
    const result = await supportRequestService.submitSupportRequest(req.user, payload, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listSupportRequests = async (req, res) => {
  try {
    const result = await supportRequestService.listSupportRequests(req.user, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getSupportRequest = async (req, res) => {
  try {
    const result = await supportRequestService.getSupportRequest(req.user, req.params.requestId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const closeSupportRequest = async (req, res) => {
  try {
    const result = await supportRequestService.closeSupportRequest(req.user, req.params.requestId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const addMessage = async (req, res) => {
  try {
    const result = await supportRequestService.addMessage(req.user, req.params.requestId, req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  submitSupportRequest,
  listSupportRequests,
  getSupportRequest,
  closeSupportRequest,
  addMessage,
};

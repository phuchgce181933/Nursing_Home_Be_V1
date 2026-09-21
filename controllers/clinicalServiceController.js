const clinicalServiceService = require('../services/clinicalServiceService');
const { sendApiError } = require('../utils/apiErrorResponse');

const listServices = async (req, res) => {
  try {
    const q = req.query || {};
    const data = await clinicalServiceService.listServices({
      active: q.active !== undefined ? (q.active === 'true' || q.active === true) : undefined,
      category: q.category,
      search: q.search,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return sendApiError(res, err);
  }
};

const getService = async (req, res) => {
  try {
    const data = await clinicalServiceService.getService(req.params.id);
    return res.json({ success: true, data });
  } catch (err) {
    return sendApiError(res, err);
  }
};

const createService = async (req, res) => {
  try {
    const data = await clinicalServiceService.createService(req.body);
    return res.json({ success: true, data });
  } catch (err) {
    return sendApiError(res, err);
  }
};

const updateService = async (req, res) => {
  try {
    const data = await clinicalServiceService.updateService(req.params.id, req.body);
    return res.json({ success: true, data });
  } catch (err) {
    return sendApiError(res, err);
  }
};

const deleteService = async (req, res) => {
  try {
    await clinicalServiceService.deleteService(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return sendApiError(res, err);
  }
};

module.exports = {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
};

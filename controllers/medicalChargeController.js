const medicalChargeService = require('../services/medicalChargeService');
const { sendApiError } = require('../utils/apiErrorResponse');

const listCharges = async (req, res) => {
  try {
    const data = await medicalChargeService.listCharges(req.query);
    return res.json({ success: true, data });
  } catch (err) {
    return sendApiError(res, err);
  }
};

const getCharge = async (req, res) => {
  try {
    const data = await medicalChargeService.getCharge(req.params.id);
    return res.json({ success: true, data });
  } catch (err) {
    return sendApiError(res, err);
  }
};

const updateCharge = async (req, res) => {
  try {
    const data = await medicalChargeService.updateCharge(req.params.id, req.body, req.user, req);
    return res.json({ success: true, data });
  } catch (err) {
    return sendApiError(res, err);
  }
};

module.exports = { listCharges, getCharge, updateCharge };

const prescriptionService = require('../services/prescriptionService');

const createPrescription = async (req, res) => {
  try {
    const result = await prescriptionService.createPrescription({
      body: req.body,
      user: req.user,
      req,
    });
    if (result.blocked) {
      console.error('[PRESCRIPTION_DEBUG] create blocked', {
        statusCode: result.statusCode,
        errorCode: result.payload?.errorCode,
        requiresAcknowledgment: result.payload?.requiresAcknowledgment,
        warningCount: result.payload?.warnings?.length || 0,
        warnings: result.payload?.warnings,
        duplicates: result.payload?.duplicates,
        detail: result.payload?.detail,
      });
      return res.status(result.statusCode).json(result.payload);
    }
    return res.status(201).json({
      success: true,
      data: result.data,
      warnings: result.warnings,
    });
  } catch (err) {
    console.error('[PRESCRIPTION_DEBUG] create exception', {
      statusCode: err.statusCode || 500,
      message: err.message,
      stack: err.stack,
    });
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

const editPrescription = async (req, res) => {
  try {
    const result = await prescriptionService.editPrescription({
      id: req.params.id,
      body: req.body,
      user: req.user,
      req,
    });
    if (result.blocked) {
      return res.status(result.statusCode).json(result.payload);
    }
    if (result.noChanges) {
      return res.status(200).json({ success: true, message: 'Không có thay đổi nào được phát hiện', data: result.data, warnings: result.warnings });
    }
    return res.status(200).json({ success: true, data: result.data, warnings: result.warnings });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

const listPrescriptions = async (req, res) => {
  try {
    const result = await prescriptionService.listPrescriptions({
      query: req.query,
      user: req.user,
    });
    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

const getPrescription = async (req, res) => {
  try {
    const data = await prescriptionService.getPrescription({
      id: req.params.id,
      user: req.user,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

const estimatePrescriptionCost = async (req, res, next) => {
  try {
    const data = await prescriptionService.estimatePrescriptionCost({
      id: req.params.id,
      residentId: req.query.residentId,
      user: req.user,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return next(err);
  }
};

const activatePrescription = async (req, res) => {
  try {
    const data = await prescriptionService.activatePrescription({
      id: req.params.id,
      user: req.user,
      req,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

const suspendPrescription = async (req, res) => {
  try {
    const data = await prescriptionService.suspendPrescription({
      id: req.params.id,
      reason: req.body.reason,
      user: req.user,
      req,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

const resumePrescription = async (req, res) => {
  try {
    const data = await prescriptionService.resumePrescription({
      id: req.params.id,
      user: req.user,
      req,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createPrescription,
  editPrescription,
  listPrescriptions,
  getPrescription,
  estimatePrescriptionCost,
  activatePrescription,
  suspendPrescription,
  resumePrescription,
};

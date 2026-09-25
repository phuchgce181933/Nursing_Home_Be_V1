const medicalRecordService = require('../services/medicalRecordService');

const parseJsonField = (value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const recordVitals = async (req, res) => {
  try {
    console.log('[medicalRecordController] recordVitals called');
    console.log('[medicalRecordController] residentId:', req.params.residentId);
    console.log('[medicalRecordController] request body keys:', Object.keys(req.body));
    console.log('[medicalRecordController] selectedServices in body:', req.body.selectedServices);

    const body = {
      ...req.body,
      physicalExamination: parseJsonField(req.body.physicalExamination),
      selectedServices: parseJsonField(req.body.selectedServices),
    };
    console.log('[medicalRecordController] parsed selectedServices:', {
      type: Array.isArray(body.selectedServices) ? 'array' : typeof body.selectedServices,
      count: Array.isArray(body.selectedServices) ? body.selectedServices.length : 0,
      consentToPayment: body.consentToPayment,
    });

    const result = await medicalRecordService.recordMedicalRecord(
      req.user,
      req.params.residentId,
      body,
      req
    );
    console.log('[medicalRecordController] recordMedicalRecord returned successfully');
    res.status(201).json(result);
  } catch (err) {
    console.error('[medicalRecordController] Error:', err.message);
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getHistory = async (req, res) => {
  try {
    const result = await medicalRecordService.getResidentMedicalHistory(
      req.user,
      req.params.residentId,
      req.query
    );
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  recordVitals,
  getHistory,
};

const medicalRecordService = require('../services/medicalRecordService');

const recordVitals = async (req, res) => {
  try {
    console.log('[medicalRecordController] recordVitals called');
    console.log('[medicalRecordController] residentId:', req.params.residentId);
    console.log('[medicalRecordController] request body keys:', Object.keys(req.body));
    console.log('[medicalRecordController] selectedServices in body:', req.body.selectedServices);
    
    const result = await medicalRecordService.recordMedicalRecord(
      req.user,
      req.params.residentId,
      req.body,
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

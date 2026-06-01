const medicalRecordService = require('../services/medicalRecordService');

const recordVitals = async (req, res) => {
  try {
    const result = await medicalRecordService.recordMedicalRecord(
      req.user,
      req.params.residentId,
      req.body,
      req
    );
    res.status(201).json(result);
  } catch (err) {
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

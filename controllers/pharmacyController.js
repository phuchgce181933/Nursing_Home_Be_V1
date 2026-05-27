const pharmacyService = require('../services/pharmacyService');

const createMedication = async (req, res) => {
  try {
    const result = await pharmacyService.createMedication(req.user, req.body, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const updateMedication = async (req, res) => {
  try {
    const result = await pharmacyService.updateMedication(req.user, req.params.medicationId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listMedications = async (req, res) => {
  try {
    const result = await pharmacyService.listMedications(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getMedication = async (req, res) => {
  try {
    const result = await pharmacyService.getMedication(req.params.medicationId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const addMedicationNote = async (req, res) => {
  try {
    const result = await pharmacyService.addMedicationNote(req.user, req.params.medicationId, req.body, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listMedicationNotes = async (req, res) => {
  try {
    const result = await pharmacyService.listMedicationNotes(req.params.medicationId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const createSupplier = async (req, res) => {
  try {
    const result = await pharmacyService.createSupplier(req.user, req.body, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const updateSupplier = async (req, res) => {
  try {
    const result = await pharmacyService.updateSupplier(req.user, req.params.supplierId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const deleteSupplier = async (req, res) => {
  try {
    const result = await pharmacyService.deleteSupplier(req.user, req.params.supplierId, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listSuppliers = async (req, res) => {
  try {
    const result = await pharmacyService.listSuppliers(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getSupplier = async (req, res) => {
  try {
    const result = await pharmacyService.getSupplier(req.params.supplierId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const createStock = async (req, res) => {
  try {
    const result = await pharmacyService.createStock(req.user, req.body, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const updateStock = async (req, res) => {
  try {
    const result = await pharmacyService.updateStock(req.user, req.params.stockId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listStocks = async (req, res) => {
  try {
    const result = await pharmacyService.listStocks(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const dispenseMedication = async (req, res) => {
  try {
    const result = await pharmacyService.dispenseMedication(req.user, req.body, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const verifyPrescription = async (req, res) => {
  try {
    const result = await pharmacyService.verifyPrescription(req.user, req.params.prescriptionId, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getLowStockAlerts = async (req, res) => {
  try {
    const result = await pharmacyService.getLowStockAlerts(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const trackExpiry = async (req, res) => {
  try {
    const result = await pharmacyService.trackExpiry(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getUsageStats = async (req, res) => {
  try {
    const result = await pharmacyService.getUsageStats(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getReportSummary = async (req, res) => {
  try {
    const result = await pharmacyService.getReportSummary(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  createMedication,
  updateMedication,
  listMedications,
  getMedication,
  addMedicationNote,
  listMedicationNotes,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  listSuppliers,
  getSupplier,
  createStock,
  updateStock,
  listStocks,
  dispenseMedication,
  verifyPrescription,
  getLowStockAlerts,
  trackExpiry,
  getUsageStats,
  getReportSummary,
};

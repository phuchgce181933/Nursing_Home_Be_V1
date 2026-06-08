// DEPRECATED — This controller is no longer used. Use prescriptionController.js and scheduleController.js instead.
const medicationService = require('../services/medicationService');

const wrap = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getMyResidents = wrap((req) => medicationService.getMyResidents(req.user));

const listPrescriptions = wrap((req) => medicationService.listPrescriptions(req.user, req.query));

const getPrescription = wrap((req) => medicationService.getPrescription(req.user, req.params.id));

const createPrescription = async (req, res) => {
  try {
    const result = await medicationService.createPrescription(req.user, req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const updatePrescription = wrap((req) =>
  medicationService.updatePrescription(req.user, req.params.id, req.body)
);

const listAdministrations = wrap((req) =>
  medicationService.listAdministrations(req.user, req.query)
);

const markAdministration = wrap((req) =>
  medicationService.markAdministration(req.user, req.params.id, req.body)
);

const getAdministrationHistory = wrap((req) =>
  medicationService.getAdministrationHistory(req.user, req.params.prescriptionId)
);

module.exports = {
  getMyResidents,
  listPrescriptions,
  getPrescription,
  createPrescription,
  updatePrescription,
  listAdministrations,
  markAdministration,
  getAdministrationHistory,
};

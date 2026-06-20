// DEPRECATED — NOT MOUNTED IN app.js. Use routes/prescriptionRoutes.js and routes/scheduleRoutes.js instead.
// DO NOT require() this file or register it in app.js.
const express = require('express');
const router = express.Router();
const {
  getMyResidents,
  listPrescriptions,
  getPrescription,
  createPrescription,
  updatePrescription,
  listAdministrations,
  markAdministration,
  getAdministrationHistory,
} = require('../controllers/medicationController');
const { protect, authorize } = require('../middleware/auth');

const CLINICAL_ROLES = ['admin', 'doctor', 'nurse'];

// Residents assigned to the calling staff member
router.get('/my-residents', protect, authorize(...CLINICAL_ROLES), getMyResidents);

// Prescriptions
router.get('/prescriptions', protect, authorize(...CLINICAL_ROLES), listPrescriptions);
router.post('/prescriptions', protect, authorize('doctor'), createPrescription);
router.get('/prescriptions/:id', protect, authorize(...CLINICAL_ROLES), getPrescription);
router.put('/prescriptions/:id', protect, authorize('doctor', 'nurse'), updatePrescription);

// Daily administrations schedule
router.get('/administrations', protect, authorize(...CLINICAL_ROLES), listAdministrations);
router.patch('/administrations/:id/status', protect, authorize('doctor', 'nurse'), markAdministration);

// History for a specific prescription
router.get('/history/:prescriptionId', protect, authorize(...CLINICAL_ROLES), getAdministrationHistory);

module.exports = router;

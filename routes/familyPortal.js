const express = require('express');
const router = express.Router();
const {
  getResidents,
  getResident,
  getVitals,
  getHealthHistory,
  getHealthChart,
  getCareNotes,
  getMedications,
  getPrescriptions,
  getActivities,
  getCareAppointments,
  getHealthReport,
} = require('../controllers/familyPortalController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('family'));

router.get('/residents', getResidents);
router.get('/residents/:residentId', getResident);
router.get('/residents/:residentId/vitals', getVitals);
router.get('/residents/:residentId/health-history', getHealthHistory);
router.get('/residents/:residentId/health-chart', getHealthChart);
router.get('/residents/:residentId/care-notes', getCareNotes);
router.get('/residents/:residentId/medications', getMedications);
router.get('/residents/:residentId/prescriptions', getPrescriptions);
router.get('/residents/:residentId/activities', getActivities);
router.get('/residents/:residentId/care-appointments', getCareAppointments);
router.get('/residents/:residentId/report', getHealthReport);

module.exports = router;

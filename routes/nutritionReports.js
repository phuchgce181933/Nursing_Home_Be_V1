const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/nutritionReportController');
const { protect, authorize } = require('../middleware/auth');

const NURSE_ROLES = ['nurse'];

/**
 * @swagger
 * tags:
 *   name: NutritionReports
 *   description: Nurse read-only nutrition reports aggregated from published plans and meal care notes
 */

router.get('/summary', protect, authorize('nurse', 'caregiver'), ctrl.getSummary);
router.get('/residents', protect, authorize(...NURSE_ROLES), ctrl.listResidents);
router.get('/residents/:residentId', protect, authorize('nurse', 'caregiver'), ctrl.getResidentReport);

module.exports = router;

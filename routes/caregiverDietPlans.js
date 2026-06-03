const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/caregiverDietPlanController');
const { protect, authorize } = require('../middleware/auth');

const CAREGIVER_ROLES = ['caregiver'];

/**
 * @swagger
 * tags:
 *   name: CaregiverDietPlans
 *   description: Caregiver read-only view of published meal plans and special diets
 */

router.get('/residents', protect, authorize(...CAREGIVER_ROLES), ctrl.listResidents);
router.get('/', protect, authorize(...CAREGIVER_ROLES), ctrl.listOverview);
router.get('/:residentId', protect, authorize(...CAREGIVER_ROLES), ctrl.getResidentPlan);

module.exports = router;

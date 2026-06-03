const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/caregiverRehabilitationScheduleController');
const { protect, authorize } = require('../middleware/auth');

const CAREGIVER_ROLES = ['caregiver'];

/**
 * @swagger
 * tags:
 *   name: CaregiverRehabilitationSchedule
 *   description: Caregiver read-only view of published rehabilitation schedules
 */

router.get('/residents', protect, authorize(...CAREGIVER_ROLES), ctrl.listResidents);
router.get('/', protect, authorize(...CAREGIVER_ROLES), ctrl.listOverview);
router.get('/:residentId', protect, authorize(...CAREGIVER_ROLES), ctrl.getResidentSchedule);

module.exports = router;

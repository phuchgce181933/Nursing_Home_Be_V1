const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dailyBehaviorController');
const { protect, authorize } = require('../middleware/auth');

const CAREGIVER_ROLES = ['caregiver'];

/**
 * @swagger
 * tags:
 *   name: CaregiverDailyBehavior
 *   description: Caregiver daily behavior and mood observations
 */

router.get('/residents', protect, authorize(...CAREGIVER_ROLES), ctrl.listResidents);
router.get('/', protect, authorize(...CAREGIVER_ROLES), ctrl.listRecords);
router.post('/', protect, authorize(...CAREGIVER_ROLES), ctrl.createRecord);
router.get('/:id', protect, authorize(...CAREGIVER_ROLES), ctrl.getRecord);
router.put('/:id', protect, authorize(...CAREGIVER_ROLES), ctrl.updateRecord);
router.delete('/:id', protect, authorize(...CAREGIVER_ROLES), ctrl.deleteRecord);

module.exports = router;

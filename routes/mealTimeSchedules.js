const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/mealTimeScheduleController');
const { protect, authorize } = require('../middleware/auth');

const NURSE_ROLES = ['nurse'];

/**
 * @swagger
 * tags:
 *   name: MealTimeSchedules
 *   description: Nurse meal time schedules with draft/publish workflow
 */

router.get('/templates', protect, authorize(...NURSE_ROLES), ctrl.getTemplates);
router.get('/residents', protect, authorize(...NURSE_ROLES), ctrl.listResidents);
router.get('/published-times', protect, authorize(...NURSE_ROLES), ctrl.getPublishedTimes);
router.post('/drafts', protect, authorize(...NURSE_ROLES), ctrl.createDraft);
router.get('/', protect, authorize('nurse', 'caregiver'), ctrl.listSchedules);
router.get('/:id', protect, authorize('nurse', 'caregiver'), ctrl.getSchedule);
router.put('/:id', protect, authorize(...NURSE_ROLES), ctrl.updateDraft);
router.delete('/:id', protect, authorize(...NURSE_ROLES), ctrl.deleteDraft);
router.post('/:id/publish', protect, authorize(...NURSE_ROLES), ctrl.publishSchedule);

module.exports = router;

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/specialDietController');
const { protect, authorize } = require('../middleware/auth');

const NURSE_ROLES = ['nurse'];

/**
 * @swagger
 * tags:
 *   name: SpecialDiets
 *   description: Nurse special diet assignments with draft/publish workflow
 */

router.get('/templates', protect, authorize(...NURSE_ROLES), ctrl.getTemplates);
router.get('/residents', protect, authorize(...NURSE_ROLES), ctrl.listResidents);
router.post('/drafts', protect, authorize(...NURSE_ROLES), ctrl.createDraft);
router.get('/', protect, authorize('nurse', 'caregiver'), ctrl.listPlans);
router.get('/:id', protect, authorize('nurse', 'caregiver'), ctrl.getPlan);
router.put('/:id', protect, authorize(...NURSE_ROLES), ctrl.updateDraft);
router.delete('/:id', protect, authorize(...NURSE_ROLES), ctrl.deleteDraft);
router.post('/:id/publish', protect, authorize(...NURSE_ROLES), ctrl.publishPlan);

module.exports = router;

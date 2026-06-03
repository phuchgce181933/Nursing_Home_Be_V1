const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/mealIntakeNoteController');
const { protect, authorize } = require('../middleware/auth');

const CAREGIVER_ROLES = ['caregiver'];

/**
 * @swagger
 * tags:
 *   name: CaregiverMealIntake
 *   description: Caregiver structured meal intake recording
 */

router.get('/residents', protect, authorize(...CAREGIVER_ROLES), ctrl.listResidents);
router.get('/context', protect, authorize(...CAREGIVER_ROLES), ctrl.getContext);
router.get('/', protect, authorize(...CAREGIVER_ROLES), ctrl.listNotes);
router.post('/', protect, authorize(...CAREGIVER_ROLES), ctrl.createNote);
router.get('/:id', protect, authorize(...CAREGIVER_ROLES), ctrl.getNote);
router.put('/:id', protect, authorize(...CAREGIVER_ROLES), ctrl.updateNote);
router.delete('/:id', protect, authorize(...CAREGIVER_ROLES), ctrl.deleteNote);

module.exports = router;

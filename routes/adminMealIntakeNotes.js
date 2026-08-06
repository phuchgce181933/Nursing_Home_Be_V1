const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/mealIntakeNoteController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('admin'));

/**
 * @swagger
 * tags:
 *   name: AdminMealIntake
 *   description: Admin read-only meal intake note list
 */

router.get('/', ctrl.adminListNotes);

module.exports = router;

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/shiftTemplateController');
const { protect } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   name: ShiftTemplates
 *   description: Three fixed default shift slots (read-only)
 */

/**
 * @swagger
 * /api/shift-templates:
 *   get:
 *     tags: [ShiftTemplates]
 *     summary: List the 3 default system shift slots
 *     description: Returns 3 default shifts with totalHours per slot and totalHoursPerDay (24h). Read-only. No minStaff limit.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: shiftType
 *         schema: { type: string, enum: [morning, afternoon, night] }
 *     responses:
 *       200: { description: Success }
 */
router.get('/', protect, ctrl.listTemplates);

/**
 * @swagger
 * /api/shift-templates/{id}:
 *   get:
 *     tags: [ShiftTemplates]
 *     summary: Get a default system shift slot by ID
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Success }
 *       404: { description: Not found }
 */
router.get('/:id', protect, ctrl.getTemplate);

module.exports = router;

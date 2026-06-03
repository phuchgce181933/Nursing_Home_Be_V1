const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/careScheduleController');
const { protect, authorize } = require('../middleware/auth');

const MANAGER = ['admin', 'manager'];

/**
 * @swagger
 * tags:
 *   name: CareSchedules
 *   description: Create and publish daily care schedules for multiple residents
 */

/**
 * @swagger
 * /api/staff/care-schedules/templates:
 *   get:
 *     tags: [CareSchedules]
 *     summary: Get default care schedule templates
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Success }
 */
router.get('/templates', protect, authorize(...MANAGER), ctrl.getTemplates);

/**
 * @swagger
 * /api/staff/care-schedules/drafts:
 *   post:
 *     tags: [CareSchedules]
 *     summary: Create a care schedule draft for a workDate
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [workDate, entries]
 *             properties:
 *               workDate: { type: string, format: date }
 *               title: { type: string }
 *               entries:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [residentId, staffProfileId, shiftId, taskType, careLevel, scheduledTime]
 *     responses:
 *       201: { description: Draft created }
 */
router.post('/drafts', protect, authorize(...MANAGER), ctrl.createDraft);

/**
 * @swagger
 * /api/staff/care-schedules:
 *   get:
 *     tags: [CareSchedules]
 *     summary: List care schedules by date/status
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: workDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, published] }
 *     responses:
 *       200: { description: Paginated list }
 */
router.get('/', protect, authorize(...MANAGER), ctrl.listSchedules);

/**
 * @swagger
 * /api/staff/care-schedules/{id}:
 *   get:
 *     tags: [CareSchedules]
 *     summary: Get care schedule detail
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Success }
 */
router.get('/:id', protect, authorize(...MANAGER), ctrl.getSchedule);

/**
 * @swagger
 * /api/staff/care-schedules/{id}:
 *   delete:
 *     tags: [CareSchedules]
 *     summary: Delete a draft care schedule (only when status is draft)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Draft deleted }
 *       400: { description: Schedule is not in draft status }
 *       404: { description: Schedule not found }
 */
router.delete('/:id', protect, authorize(...MANAGER), ctrl.deleteDraft);

/**
 * @swagger
 * /api/staff/care-schedules/{id}:
 *   put:
 *     tags: [CareSchedules]
 *     summary: Update a draft care schedule
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated }
 */
router.put('/:id', protect, authorize(...MANAGER), ctrl.updateDraft);

/**
 * @swagger
 * /api/staff/care-schedules/{id}/publish:
 *   post:
 *     tags: [CareSchedules]
 *     summary: Publish a draft schedule and generate pending care tasks
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Published }
 */
router.post('/:id/publish', protect, authorize(...MANAGER), ctrl.publishSchedule);

module.exports = router;


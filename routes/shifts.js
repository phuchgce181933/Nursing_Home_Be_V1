const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/shiftController');
const { protect, authorize } = require('../middleware/auth');

const MANAGER = ['admin', 'manager'];

/**
 * @swagger
 * tags:
 *   name: Shifts
 *   description: Work shift scheduling and management
 */

/**
 * @swagger
 * /api/shifts:
 *   get:
 *     tags: [Shifts]
 *     summary: List shifts with optional filters
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, published, confirmed, completed, cancelled] }
 *       - in: query
 *         name: assignedStaffId
 *         schema: { type: string }
 *       - in: query
 *         name: floorId
 *         schema: { type: string }
 *       - in: query
 *         name: fromDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: toDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Success }
 */
router.get('/', protect, ctrl.listShifts);

/**
 * @swagger
 * /api/shifts/schedule:
 *   get:
 *     tags: [Shifts]
 *     summary: Get schedule view (day/week/month)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: fromDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: toDate
 *         required: true
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: Success }
 */
router.get('/schedule', protect, ctrl.getSchedule);

/**
 * @swagger
 * /api/shifts/check-conflicts:
 *   get:
 *     tags: [Shifts]
 *     summary: Preview shift validation conflicts (8 business rules)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: assignedStaffId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: workDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: startTime
 *         required: true
 *         schema: { type: string, example: "07:00" }
 *       - in: query
 *         name: endTime
 *         required: true
 *         schema: { type: string, example: "15:00" }
 *       - in: query
 *         name: excludeId
 *         schema: { type: string }
 *       - in: query
 *         name: shiftTemplateId
 *         schema: { type: string }
 *       - in: query
 *     responses:
 *       200: { description: Conflict list with hasErrors flag }
 */
router.get('/check-conflicts', protect, authorize(...MANAGER), ctrl.checkConflicts);

/**
 * @swagger
 * /api/shifts/{id}:
 *   get:
 *     tags: [Shifts]
 *     summary: Get a single shift by ID
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
router.get('/:id', protect, ctrl.getShift);

/**
 * @swagger
 * /api/shifts:
 *   post:
 *     tags: [Shifts]
 *     summary: Create a shift (status = draft, returns conflict warnings)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, startTime, endTime, workDate, assignedStaffId]
 *             properties:
 *               name: { type: string }
 *               startTime: { type: string, example: "07:00" }
 *               endTime: { type: string, example: "15:00" }
 *               workDate: { type: string, format: date }
 *               assignedStaffId: { type: string }
 *               shiftTemplateId: { type: string }
 *               taskDescription: { type: string }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Shift created (floor/room assigned via PUT /api/staff/{id}/areas) }
 *       400: { description: Validation error }
 */
router.post('/', protect, authorize(...MANAGER), ctrl.createShift);

/**
 * @swagger
 * /api/shifts/{id}/publish:
 *   put:
 *     tags: [Shifts]
 *     summary: Publish a draft shift (runs full conflict check, blocks on ERROR)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Published }
 *       400: { description: Not in draft status }
 *       409: { description: Blocking conflicts exist }
 */
router.put('/:id/publish', protect, authorize(...MANAGER), ctrl.publishShift);

/**
 * @swagger
 * /api/shifts/{id}/confirm:
 *   put:
 *     tags: [Shifts]
 *     summary: Confirm a published shift
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Confirmed }
 *       400: { description: Not in published status }
 */
router.put('/:id/confirm', protect, authorize(...MANAGER), ctrl.confirmShift);

/**
 * @swagger
 * /api/shifts/{id}/cancel:
 *   put:
 *     tags: [Shifts]
 *     summary: Cancel a shift
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Cancelled }
 */
router.put('/:id/cancel', protect, authorize(...MANAGER), ctrl.cancelShift);

// ── Generic /:id AFTER sub-resource routes ────────────────────────────────────

/**
 * @swagger
 * /api/shifts/{id}:
 *   put:
 *     tags: [Shifts]
 *     summary: Update a shift (changeReason required; blocked if completed/confirmed or < 2h before start for non-admins)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [changeReason]
 *             properties:
 *               name: { type: string }
 *               startTime: { type: string }
 *               endTime: { type: string }
 *               workDate: { type: string, format: date }
 *               assignedStaffId: { type: string }
 *               shiftTemplateId: { type: string }
 *               taskDescription: { type: string }
 *               changeReason: { type: string }
 *     responses:
 *       200: { description: Updated }
 */
router.put('/:id', protect, authorize(...MANAGER), ctrl.updateShift);

/**
 * @swagger
 * /api/shifts/{id}:
 *   delete:
 *     tags: [Shifts]
 *     summary: Delete a shift (only draft shifts)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       400: { description: Shift is not in draft status }
 */
router.delete('/:id', protect, authorize(...MANAGER), ctrl.deleteShift);

module.exports = router;

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/shiftController');
const { protect, authorize } = require('../middleware/auth');
//lenhuthao
const MANAGER = ['admin'];
const STAFF_SHIFT_ROLES = ['doctor', 'nurse', 'caregiver', 'staff', 'pharmacist'];

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
 *     summary: Preview shift validation conflicts (7 business rules)
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
 *         name: shiftTemplateId
 *         required: true
 *         schema: { type: string, description: "ObjectId of a default shift slot (DAWN/DAY/EVENING/SPLIT)" }
 *       - in: query
 *         name: startTime
 *         schema: { type: string, example: "10:00", description: "Required for SPLIT (ca gãy) template" }
 *       - in: query
 *         name: endTime
 *         schema: { type: string, example: "14:00", description: "Required for SPLIT (ca gãy) template" }
 *       - in: query
 *         name: excludeId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Conflict list with hasErrors flag }
 */
router.get('/check-conflicts', protect, authorize(...MANAGER), ctrl.checkConflicts);

/**
 * @swagger
 * /api/shifts/my:
 *   get:
 *     tags: [Shifts]
 *     summary: List shifts assigned to the logged-in staff member
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [published, confirmed, completed, cancelled] }
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
 *       404: { description: Staff profile not found }
 */
router.get('/my', protect, authorize(...STAFF_SHIFT_ROLES), ctrl.listMyShifts);

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
 *     summary: Create a shift assignment (status = draft, times derived from shiftTemplateId)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [shiftTemplateId, workDate, assignedStaffId]
 *             properties:
 *               shiftTemplateId: { type: string, description: "ObjectId of DAWN, DAY, EVENING, or SPLIT (ca gãy)" }
 *               workDate: { type: string, format: date }
 *               assignedStaffId: { type: string }
 *               startTime: { type: string, example: "10:00", description: "Required when shiftTemplateId is SPLIT" }
 *               endTime: { type: string, example: "14:00", description: "Required when shiftTemplateId is SPLIT" }
 *               taskDescription: { type: string }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: Shift created (floor/room assigned via PUT /api/staff/{id}/areas)
 *       400:
 *         description: Validation error
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
 *     summary: Confirm a published shift (assigned staff only; admin/manager cannot confirm)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Confirmed }
 *       400: { description: Not in published status }
 *       403: { description: Admin/manager or non-assigned staff }
 */
router.put('/:id/confirm', protect, authorize(...STAFF_SHIFT_ROLES), ctrl.confirmShift);

/**
 * @swagger
 * /api/shifts/{id}/complete:
 *   put:
 *     tags: [Shifts]
 *     summary: Mark a confirmed shift as completed (assigned staff only; within 15 min after shift end)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Completed }
 *       400: { description: Not confirmed, not ended, or window closed }
 *       403: { description: Admin/manager or non-assigned staff }
 */
router.put('/:id/complete', protect, authorize(...STAFF_SHIFT_ROLES), ctrl.completeShift);

/**
 * @swagger
 * /api/shifts/{id}/cancel:
 *   put:
 *     tags: [Shifts]
 *     summary: Cancel a shift (published or confirmed only)
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
 *       400: { description: Shift not in published or confirmed status }
 *       409: { description: Active care tasks on this shift; blockingTasks in response }
 */
router.put('/:id/cancel', protect, authorize(...MANAGER), ctrl.cancelShift);

// ── Generic /:id AFTER sub-resource routes ────────────────────────────────────

/**
 * @swagger
 * /api/shifts/{id}:
 *   put:
 *     tags: [Shifts]
 *     summary: Update a shift (changeReason optional; blocked if completed/confirmed or < 2h before start for non-admins)
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
 *             properties:
 *               workDate: { type: string, format: date }
 *               assignedStaffId: { type: string }
 *               shiftTemplateId: { type: string, description: "Change shift slot; times are derived automatically" }
 *               taskDescription: { type: string }
 *               notes: { type: string }
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
 *       409: { description: Active care tasks on this shift; blockingTasks in response }
 */
router.delete('/:id', protect, authorize(...MANAGER), ctrl.deleteShift);

module.exports = router;

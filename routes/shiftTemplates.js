const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/shiftTemplateController');
const { protect, authorize } = require('../middleware/auth');

const MANAGER = ['admin', 'manager'];

/**
 * @swagger
 * tags:
 *   name: ShiftTemplates
 *   description: Manage reusable shift templates
 */

/**
 * @swagger
 * /api/shift-templates:
 *   get:
 *     tags: [ShiftTemplates]
 *     summary: List all shift templates
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive] }
 *       - in: query
 *         name: shiftType
 *         schema: { type: string, enum: [morning, afternoon, night, on_call] }
 *       - in: query
 *         name: department
 *         schema: { type: string }
 *     responses:
 *       200: { description: Success }
 */
router.get('/', protect, ctrl.listTemplates);

/**
 * @swagger
 * /api/shift-templates:
 *   post:
 *     tags: [ShiftTemplates]
 *     summary: Create a shift template
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, shiftCode, shiftType, startTime, endTime]
 *             properties:
 *               name: { type: string }
 *               shiftCode: { type: string, example: "S1" }
 *               shiftType: { type: string, enum: [morning, afternoon, night, on_call] }
 *               startTime: { type: string, example: "07:00" }
 *               endTime: { type: string, example: "15:00" }
 *               department: { type: string, description: "Floor ObjectId" }
 *               colorLabel: { type: string, example: "#4CAF50" }
 *               minStaff: { type: integer, example: 2 }
 *               description: { type: string }
 *     responses:
 *       201: { description: Created }
 *       400: { description: Validation error }
 */
router.post('/', protect, authorize(...MANAGER), ctrl.createTemplate);

// ── Sub-resource routes MUST be registered before /:id ──────────────────────

/**
 * @swagger
 * /api/shift-templates/{id}/status:
 *   put:
 *     tags: [ShiftTemplates]
 *     summary: Toggle template status between active and inactive
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
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [active, inactive] }
 *     responses:
 *       200: { description: Status updated }
 */
router.put('/:id/status', protect, authorize(...MANAGER), ctrl.updateTemplateStatus);

// ── Generic /:id routes AFTER sub-resource routes ────────────────────────────

/**
 * @swagger
 * /api/shift-templates/{id}:
 *   get:
 *     tags: [ShiftTemplates]
 *     summary: Get shift template by ID
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

/**
 * @swagger
 * /api/shift-templates/{id}:
 *   put:
 *     tags: [ShiftTemplates]
 *     summary: Update a shift template (warns if future shifts exist)
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
 *               name: { type: string }
 *               shiftCode: { type: string }
 *               shiftType: { type: string }
 *               startTime: { type: string }
 *               endTime: { type: string }
 *               colorLabel: { type: string }
 *               minStaff: { type: integer }
 *               description: { type: string }
 *     responses:
 *       200: { description: Updated }
 */
router.put('/:id', protect, authorize(...MANAGER), ctrl.updateTemplate);

/**
 * @swagger
 * /api/shift-templates/{id}:
 *   delete:
 *     tags: [ShiftTemplates]
 *     summary: Delete a template (only when no future shifts reference it)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       409: { description: Future shifts still reference this template }
 */
router.delete('/:id', protect, authorize(...MANAGER), ctrl.deleteTemplate);

module.exports = router;

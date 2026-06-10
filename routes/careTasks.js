const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/careTaskController');
const { protect, authorize } = require('../middleware/auth');

const MANAGER = ['admin', 'manager'];

/**
 * @swagger
 * tags:
 *   name: CareTasks
 *   description: Elderly care task assignment and tracking
 */

/**
 * @swagger
 * /api/care-tasks:
 *   post:
 *     tags: [CareTasks]
 *     summary: Assign a care task to nurse or doctor only (VN rules; auto-missed when shift ends without completion)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [staffProfileId, residentId, shiftId, taskType, careLevel, workDate, scheduledTime]
 *             properties:
 *               staffProfileId: { type: string, description: "StaffProfile _id (or use userId)" }
 *               userId: { type: string, description: "User _id alias for staffProfileId" }
 *               residentId: { type: string, description: "Must be in staff assignedResidentIds" }
 *               shiftId: { type: string, description: "Required; staff published/confirmed shift on workDate" }
 *               taskType:
 *                 type: string
 *                 enum: [morning_care, medication, physical_therapy, meal_assistance, evening_check, emergency_response]
 *               careLevel:
 *                 type: string
 *                 enum: [low, medium, high]
 *               workDate: { type: string, format: date, description: "Must be today or future (VN). Staff must have shift on this date." }
 *               scheduledTime: { type: string, example: "07:30", description: "Required HH:mm within shift; must not be in the past" }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Task created with shiftId }
 *       400: { description: Validation error, assignee not nurse/doctor, past datetime, or ended shift }
 */
router.post('/', protect, authorize(...MANAGER), ctrl.assignCareTask);

/**
 * @swagger
 * /api/care-tasks/assignment-context:
 *   get:
 *     tags: [CareTasks]
 *     summary: Form context — staff with shifts, task types, care levels for a date
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: workDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: '2026-05-26'
 *     responses:
 *       200:
 *         description: staffWithShifts (only non-ended shifts for today), taskTypes, careLevels, minScheduledTime, serverNow
 *       400:
 *         description: workDate in the past
 */
router.get('/assignment-context', protect, authorize(...MANAGER), ctrl.getAssignmentContext);

/**
 * @swagger
 * /api/care-tasks/by-shift/{shiftId}:
 *   get:
 *     tags: [CareTasks]
 *     summary: Get all care tasks linked to a specific shift
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: shiftId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Success }
 */
router.get('/by-shift/:shiftId', protect, authorize(...MANAGER), ctrl.getCareTasksByShift);

/**
 * @swagger
 * /api/care-tasks:
 *   get:
 *     tags: [CareTasks]
 *     summary: List care tasks with filters
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: staffProfileId
 *         schema: { type: string }
 *       - in: query
 *         name: residentId
 *         schema: { type: string }
 *       - in: query
 *         name: workDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, in_progress, completed, skipped, missed] }
 *       - in: query
 *         name: taskType
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Paginated list }
 */
router.get('/', protect, authorize(...MANAGER), ctrl.listCareTasks);

/**
 * @swagger
 * /api/care-tasks/{id}:
 *   get:
 *     tags: [CareTasks]
 *     summary: Get care task detail
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
router.get('/:id', protect, authorize(...MANAGER), ctrl.getCareTask);

/**
 * @swagger
 * /api/care-tasks/{id}/status:
 *   put:
 *     tags: [CareTasks]
 *     summary: Update care task status
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
 *               status:
 *                 type: string
 *                 enum: [in_progress, completed, skipped]
 *                 description: "Manual only. missed (bỏ lỡ) is set by the system when the shift ends."
 *               notes: { type: string }
 *     responses:
 *       200: { description: Status updated }
 *       400: { description: Invalid transition or attempted manual missed }
 *       403: { description: in_progress/completed require the assigned nurse or doctor }
 */
router.put('/:id/status', protect, authorize(...MANAGER), ctrl.updateCareTaskStatus);

/**
 * @swagger
 * /api/care-tasks/{id}:
 *   delete:
 *     tags: [CareTasks]
 *     summary: Delete a pending care task
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       400: { description: Only pending tasks can be deleted }
 */
router.delete('/:id', protect, authorize(...MANAGER), ctrl.deleteCareTask);

module.exports = router;

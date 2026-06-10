const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/caregiverCareTaskController');
const { protect, authorize } = require('../middleware/auth');

const CARE_TASK_SELF_SERVICE_ROLES = ['caregiver', 'nurse', 'doctor'];

/**
 * @swagger
 * tags:
 *   name: CaregiverCareTasks
 *   description: Caregiver daily care schedule (own CareTask list)
 */

/**
 * @swagger
 * /api/caregiver/care-tasks:
 *   get:
 *     summary: List care tasks assigned to the logged-in caregiver for a workDate
 *     tags: [CaregiverCareTasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: workDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, in_progress, completed, skipped, missed]
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
 *       - in: query
 *         name: taskType
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated care tasks for the caregiver
 */
router.get('/', protect, authorize(...CARE_TASK_SELF_SERVICE_ROLES), ctrl.listTasks);

/**
 * @swagger
 * /api/caregiver/care-tasks/{id}:
 *   get:
 *     summary: Get one care task detail (own tasks only)
 *     tags: [CaregiverCareTasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Task detail
 *       403:
 *         description: Not your task
 */
router.get('/:id', protect, authorize(...CARE_TASK_SELF_SERVICE_ROLES), ctrl.getTask);

/**
 * @swagger
 * /api/caregiver/care-tasks/{id}/status:
 *   put:
 *     summary: Update care task status (in_progress, completed, skipped)
 *     tags: [CaregiverCareTasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status updated
 */
router.put('/:id/status', protect, authorize(...CARE_TASK_SELF_SERVICE_ROLES), ctrl.updateStatus);

module.exports = router;

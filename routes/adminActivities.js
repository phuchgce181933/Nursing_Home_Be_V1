const express = require('express');
const router = express.Router();
const {
  createActivity,
  listActivities,
  getActivity,
  updateActivity,
  deleteActivity,
  updateActivityStatus,
  setParticipantList,
  registerResident,
  recordParticipationResult,
  getActivityStatistics,
  getActivityStatisticsById,
} = require('../controllers/activityController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('admin'));

/**
 * @swagger
 * /api/admin/activities:
 *   post:
 *     summary: Create a new activity (Admin)
 *     tags: [Admin - Activity Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, scheduledAt]
 *             properties:
 *               title:
 *                 type: string
 *               category:
 *                 type: string
 *               description:
 *                 type: string
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *               durationMinutes:
 *                 type: integer
 *               location:
 *                 type: string
 *               organizerStaffId:
 *                 type: string
 *               participantResidentIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               status:
 *                 type: string
 *                 enum: [draft, scheduled, ongoing, completed, cancelled]
 *     responses:
 *       201:
 *         description: Activity created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 */
router.post('/', createActivity);

/**
 * @swagger
 * /api/admin/activities:
 *   get:
 *     summary: List or search activities (Admin)
 *     tags: [Admin - Activity Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: organizerStaffId
 *         schema:
 *           type: string
 *       - in: query
 *         name: participantResidentId
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated list of activities
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 */
router.get('/', listActivities);

/**
 * @swagger
 * /api/admin/activities/statistics:
 *   get:
 *     summary: Get activity statistics (Admin)
 *     tags: [Admin - Activity Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Activity statistics retrieved
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 */
router.get('/statistics', getActivityStatistics);

/**
 * @swagger
 * /api/admin/activities/{activityId}:
 *   get:
 *     summary: Get activity details (Admin)
 *     tags: [Admin - Activity Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: activityId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Activity details retrieved
 *       404:
 *         description: Activity not found
 */
router.get('/:activityId', getActivity);

/**
 * @swagger
 * /api/admin/activities/{activityId}/statistics:
 *   get:
 *     summary: Get statistics for a specific activity (Admin)
 *     tags: [Admin - Activity Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: activityId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Activity statistics retrieved
 *       404:
 *         description: Activity not found
 */
router.get('/:activityId/statistics', getActivityStatisticsById);

/**
 * @swagger
 * /api/admin/activities/{activityId}:
 *   put:
 *     summary: Update activity details (Admin)
 *     tags: [Admin - Activity Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: activityId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               category:
 *                 type: string
 *               description:
 *                 type: string
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *               durationMinutes:
 *                 type: integer
 *               location:
 *                 type: string
 *               organizerStaffId:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [draft, scheduled, ongoing, completed, cancelled]
 *               participantResidentIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Activity updated successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Activity not found
 */
router.put('/:activityId', updateActivity);

/**
 * @swagger
 * /api/admin/activities/{activityId}:
 *   delete:
 *     summary: Delete an activity (Admin)
 *     tags: [Admin - Activity Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: activityId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Activity deleted successfully
 *       404:
 *         description: Activity not found
 */
router.delete('/:activityId', deleteActivity);

/**
 * @swagger
 * /api/admin/activities/{activityId}/status:
 *   patch:
 *     summary: Update activity status (Admin)
 *     tags: [Admin - Activity Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: activityId
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
 *                 enum: [draft, scheduled, ongoing, completed, cancelled]
 *     responses:
 *       200:
 *         description: Activity status updated successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Activity not found
 */
router.patch('/:activityId/status', updateActivityStatus);

/**
 * @swagger
 * /api/admin/activities/{activityId}/participants:
 *   put:
 *     summary: Update participant list for an activity (Admin)
 *     tags: [Admin - Activity Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: activityId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [participantResidentIds]
 *             properties:
 *               participantResidentIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Participant list updated successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Activity not found
 */
router.put('/:activityId/participants', setParticipantList);

/**
 * @swagger
 * /api/admin/activities/{activityId}/register:
 *   post:
 *     summary: Register a resident for an activity (Admin)
 *     tags: [Admin - Activity Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: activityId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [residentId]
 *             properties:
 *               residentId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Resident registered successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Activity not found
 */
router.post('/:activityId/register', registerResident);

/**
 * @swagger
 * /api/admin/activities/{activityId}/record-result:
 *   post:
 *     summary: Record participation result for an activity (Admin)
 *     tags: [Admin - Activity Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: activityId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               participantResultNotes:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [draft, scheduled, ongoing, completed, cancelled]
 *     responses:
 *       200:
 *         description: Participation result recorded successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Activity not found
 */
router.post('/:activityId/record-result', recordParticipationResult);

module.exports = router;

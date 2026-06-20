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

/**
 * @swagger
 * /api/admin/activities:
 *   post:
 *     summary: Create a new activity (Admin only)
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
router.post('/', protect, authorize('admin'), createActivity);

/**
 * @swagger
 * /api/admin/activities:
 *   get:
 *     summary: List or search activities (Admin, Manager, Nurse, Doctor, Family)
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
router.get('/', protect, authorize('admin', 'doctor', 'nurse', 'family'), listActivities);

/**
 * @swagger
 * /api/admin/activities/statistics:
 *   get:
 *     summary: Get activity statistics (Admin, Manager)
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
router.get('/statistics', protect, authorize('admin'), getActivityStatistics);

/**
 * @swagger
 * /api/admin/activities/{activityId}:
 *   get:
 *     summary: Get activity details (Admin, Manager, Nurse, Doctor, Family)
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
router.get('/:activityId', protect, authorize('admin', 'doctor', 'nurse', 'family'), getActivity);

/**
 * @swagger
 * /api/admin/activities/{activityId}/statistics:
 *   get:
 *     summary: Get statistics for a specific activity (Admin, Manager)
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
router.get('/:activityId/statistics', protect, authorize('admin'), getActivityStatisticsById);

/**
 * @swagger
 * /api/admin/activities/{activityId}:
 *   put:
 *     summary: Update activity details (Admin only)
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
router.put('/:activityId', protect, authorize('admin'), updateActivity);

/**
 * @swagger
 * /api/admin/activities/{activityId}:
 *   delete:
 *     summary: Delete an activity (Admin only)
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
router.delete('/:activityId', protect, authorize('admin'), deleteActivity);

/**
 * @swagger
 * /api/admin/activities/{activityId}/status:
 *   patch:
 *     summary: Update activity status (Admin only)
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
router.patch('/:activityId/status', protect, authorize('admin'), updateActivityStatus);

/**
 * @swagger
 * /api/admin/activities/{activityId}/participants:
 *   put:
 *     summary: Update participant list for an activity (Admin only)
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
router.put('/:activityId/participants', protect, authorize('admin'), setParticipantList);

/**
 * @swagger
 * /api/admin/activities/{activityId}/register:
 *   post:
 *     summary: Register a resident for an activity (Admin, Family)
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
router.post('/:activityId/register', protect, authorize('admin', 'family'), registerResident);

/**
 * @swagger
 * /api/admin/activities/{activityId}/record-result:
 *   post:
 *     summary: Record participation result for an activity (Admin only)
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
router.post('/:activityId/record-result', protect, authorize('admin'), recordParticipationResult);

module.exports = router;

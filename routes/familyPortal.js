const express = require('express');
const router = express.Router();
const {
  getResidents,
  getResident,
  getVitals,
  getHealthHistory,
  getHealthChart,
  getCareNotes,
  getMedications,
  getPrescriptions,
  getActivities,
  getCareAppointments,
  getHealthReport,
} = require('../controllers/familyPortalController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('family'));

/**
 * @swagger
 * /api/family/residents:
 *   get:
 *     summary: Get all residents linked to the logged-in family account
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of linked residents
 */
router.get('/residents', getResidents);

/**
 * @swagger
 * /api/family/residents/{residentId}:
 *   get:
 *     summary: Get resident details
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resident details
 *       403:
 *         description: Access denied
 *       404:
 *         description: Resident not found
 */
router.get('/residents/:residentId', getResident);

/**
 * @swagger
 * /api/family/residents/{residentId}/vitals:
 *   get:
 *     summary: Get latest vitals record for a resident
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Latest vitals record (or null if none)
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/vitals', getVitals);

/**
 * @swagger
 * /api/family/residents/{residentId}/health-history:
 *   get:
 *     summary: Get paginated medical record history
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter measuredAt >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter measuredAt <= to
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in summary text
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated medical records
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/health-history', getHealthHistory);

/**
 * @swagger
 * /api/family/residents/{residentId}/health-chart:
 *   get:
 *     summary: Get time-series vitals data for charting (default last 30 days)
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [bloodPressureSystolic, bloodPressureDiastolic, pulse, temperatureCelsius, oxygenSaturation, bloodSugar, weightKg]
 *         description: Specific metric to return (returns all metrics if omitted)
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
 *         description: Time-series vitals array
 *       400:
 *         description: Invalid metric value
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/health-chart', getHealthChart);

/**
 * @swagger
 * /api/family/residents/{residentId}/care-notes:
 *   get:
 *     summary: Get paginated care notes for a resident
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: noteType
 *         schema:
 *           type: string
 *           enum: [meal, activity, health, general]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in note content
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
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated care notes
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/care-notes', getCareNotes);

/**
 * @swagger
 * /api/family/residents/{residentId}/medications:
 *   get:
 *     summary: Get paginated medication schedule records for a resident
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, TAKEN, LATE_TAKEN, MISSED, SKIPPED]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledTime >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledTime <= to
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated medication schedule records
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/medications', getMedications);

/**
 * @swagger
 * /api/family/residents/{residentId}/prescriptions:
 *   get:
 *     summary: Get prescriptions for a resident
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, COMPLETED, CANCELLED]
 *     responses:
 *       200:
 *         description: List of prescriptions (sorted by prescriptionDate desc)
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/prescriptions', getPrescriptions);

/**
 * @swagger
 * /api/family/residents/{residentId}/activities:
 *   get:
 *     summary: Get activities the resident participates in
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, scheduled, ongoing, completed, cancelled]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledAt >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledAt <= to
 *     responses:
 *       200:
 *         description: List of activities
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/activities', getActivities);

/**
 * @swagger
 * /api/family/residents/{residentId}/care-appointments:
 *   get:
 *     summary: Get care appointments for a resident
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [scheduled, in_progress, completed, cancelled]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledStartAt >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledStartAt <= to
 *     responses:
 *       200:
 *         description: List of care appointments
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/care-appointments', getCareAppointments);

/**
 * @swagger
 * /api/family/residents/{residentId}/report:
 *   get:
 *     summary: Get comprehensive health report for a resident
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Report period start (no filter if omitted)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Report period end (no filter if omitted)
 *     responses:
 *       200:
 *         description: Health report with vitals, care notes, appointments, medications
 *       403:
 *         description: Access denied
 *       404:
 *         description: Resident not found
 */
router.get('/residents/:residentId/report', getHealthReport);

module.exports = router;

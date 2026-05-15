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
 * /api/family-portal/residents:
 *   get:
 *     summary: Get all residents (Family Portal)
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of residents
 */
router.get('/residents', getResidents);

/**
 * @swagger
 * /api/family-portal/residents/{residentId}:
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
 */
router.get('/residents/:residentId', getResident);

/**
 * @swagger
 * /api/family-portal/residents/{residentId}/vitals:
 *   get:
 *     summary: Get resident vitals
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
 *         description: Resident vitals
 */
router.get('/residents/:residentId/vitals', getVitals);

/**
 * @swagger
 * /api/family-portal/residents/{residentId}/health-history:
 *   get:
 *     summary: Get resident health history
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
 *         description: Health history retrieved
 */
router.get('/residents/:residentId/health-history', getHealthHistory);

/**
 * @swagger
 * /api/family-portal/residents/{residentId}/health-chart:
 *   get:
 *     summary: Get resident health chart
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
 *         description: Health chart retrieved
 */
router.get('/residents/:residentId/health-chart', getHealthChart);

/**
 * @swagger
 * /api/family-portal/residents/{residentId}/care-notes:
 *   get:
 *     summary: Get resident care notes
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
 *         description: Care notes retrieved
 */
router.get('/residents/:residentId/care-notes', getCareNotes);

/**
 * @swagger
 * /api/family-portal/residents/{residentId}/medications:
 *   get:
 *     summary: Get resident medications
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
 *         description: Medications retrieved
 */
router.get('/residents/:residentId/medications', getMedications);

/**
 * @swagger
 * /api/family-portal/residents/{residentId}/prescriptions:
 *   get:
 *     summary: Get resident prescriptions
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
 *         description: Prescriptions retrieved
 */
router.get('/residents/:residentId/prescriptions', getPrescriptions);

/**
 * @swagger
 * /api/family-portal/residents/{residentId}/activities:
 *   get:
 *     summary: Get resident activities
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
 *         description: Activities retrieved
 */
router.get('/residents/:residentId/activities', getActivities);

/**
 * @swagger
 * /api/family-portal/residents/{residentId}/care-appointments:
 *   get:
 *     summary: Get resident care appointments
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
 *         description: Care appointments retrieved
 */
router.get('/residents/:residentId/care-appointments', getCareAppointments);

/**
 * @swagger
 * /api/family-portal/residents/{residentId}/report:
 *   get:
 *     summary: Get resident health report
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
 *         description: Health report retrieved
 */
router.get('/residents/:residentId/report', getHealthReport);

module.exports = router;

const express = require('express');

const router = express.Router();
const {
  createIncident,
  listIncidents,
  getIncident,
  updateIncidentStatus,
  assignHandlers,
  exportIncidents,
  getAssignmentConflicts,
} = require('../controllers/incidentController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);
router.use(authorize('doctor', 'nurse', 'admin', 'manager', 'caregiver', 'pharmacist'));

/**
 * @swagger
 * /api/incidents:
 *   post:
 *     summary: Create incident report
 *     tags: [Incident Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - incidentType
 *               - incidentAt
 *               - description
 *             properties:
 *               residentId:
 *                 type: string
 *               incidentType:
 *                 type: string
 *               severity:
 *                 type: string
 *                 enum: [low, medium, high, critical]
 *               incidentAt:
 *                 type: string
 *                 format: date-time
 *               location:
 *                 type: string
 *               description:
 *                 type: string
 *               assignedStaffIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               residentIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Incident created and notifications sent when possible
 */
router.post('/', createIncident);

/**
 * @swagger
 * /api/incidents:
 *   get:
 *     summary: Search and list incidents
 *     tags: [Incident Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, investigating, resolved, closed]
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [low, medium, high, critical]
 *       - in: query
 *         name: incidentType
 *         schema:
 *           type: string
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
 *       - in: query
 *         name: reporterRole
 *         schema:
 *           type: string
 *       - in: query
 *         name: incidentFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: incidentTo
 *         schema:
 *           type: string
 *           format: date
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
 *         description: Paginated incident list
 */
router.get('/', listIncidents);

router.post('/assignment-conflicts', authorize('admin'), getAssignmentConflicts);

/**
 * @swagger
 * /api/incidents/export:
 *   get:
 *     summary: Export incident reports as CSV
 *     tags: [Incident Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Downloadable CSV incident report
 */
router.get('/export', exportIncidents);

/**
 * @swagger
 * /api/incidents/{id}:
 *   get:
 *     summary: Get incident details
 *     tags: [Incident Management]
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
 *         description: Incident details
 */
router.get('/:id', getIncident);

/**
 * @swagger
 * /api/incidents/{id}/status:
 *   patch:
 *     summary: Update incident status
 *     tags: [Incident Management]
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
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [open, investigating, resolved, closed]
 *     responses:
 *       200:
 *         description: Incident status updated
 */
router.patch('/:id/status', updateIncidentStatus);

/**
 * @swagger
 * /api/incidents/{id}/resolution:
 *   patch:
 *     summary: Update incident resolution (save draft or mark resolved)
 *     tags: [Incident Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *               method:
 *                 type: string
 *               rootCause:
 *                 type: string
 *               detailedCause:
 *                 type: string
 *               immediateActions:
 *                 type: string
 *               result:
 *                 type: string
 *               action:
 *                 type: string
 *               resolutionFiles:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Incident resolution updated
 */
router.patch('/:id/resolution', require('../controllers/incidentController').updateIncidentResolution);

/**
 * @swagger
 * /api/incidents/{id}/handlers:
 *   patch:
 *     summary: Assign handlers to incident (admin only)
 *     tags: [Incident Management]
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
 *             required:
 *               - assignedStaffIds
 *             properties:
 *               assignedStaffIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of staff profile IDs or user IDs
 *     responses:
 *       200:
 *         description: Handlers assigned to incident
 *       403:
 *         description: Only admins can assign handlers
 *       400:
 *         description: Handlers already assigned or no handlers specified
 */
router.patch('/:id/handlers', authorize('admin'), assignHandlers);

module.exports = router;

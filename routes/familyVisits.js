const express = require('express');
const router = express.Router();
const { createVisit, listFamilyVisits, cancelVisit } = require('../controllers/residentVisitController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('family'));

/**
 * @swagger
 * /api/family/visits:
 *   post:
 *     summary: Request a visit to an admitted resident (Family)
 *     tags: [Family - Resident Visit]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [residentId, visitorName, visitorPhone, requestedDate]
 *             properties:
 *               residentId: { type: string }
 *               visitorName: { type: string }
 *               visitorPhone: { type: string }
 *               requestedDate: { type: string, format: date }
 *               requestedTimeSlot: { type: string, example: "14:00-15:00" }
 *               numberOfVisitors: { type: integer, minimum: 1, maximum: 20, default: 1 }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Visit request created }
 *       400: { description: Validation error }
 *       403: { description: Not your relative }
 */
router.post('/', createVisit);

/**
 * @swagger
 * /api/family/visits:
 *   get:
 *     summary: List own visit requests (Family)
 *     tags: [Family - Resident Visit]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: residentId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected, cancelled] }
 *     responses:
 *       200: { description: Paginated visit list }
 */
router.get('/', listFamilyVisits);

/**
 * @swagger
 * /api/family/visits/{visitId}/cancel:
 *   patch:
 *     summary: Cancel a pending or approved visit request (Family)
 *     tags: [Family - Resident Visit]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: visitId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Cancelled }
 *       400: { description: Cannot cancel (wrong status) }
 *       404: { description: Not found }
 */
router.patch('/:visitId/cancel', cancelVisit);

module.exports = router;

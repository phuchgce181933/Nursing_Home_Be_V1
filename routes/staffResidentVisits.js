const express = require('express');
const router = express.Router();
const { listVisits, approveVisit, rejectVisit } = require('../controllers/residentVisitController');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * /api/resident-visits:
 *   get:
 *     summary: List resident visit requests (Nurse/Manager/Admin)
 *     tags: [Staff - Resident Visit]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected, cancelled] }
 *       - in: query
 *         name: residentId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Paginated visit list }
 */
router.get('/', protect, authorize('nurse', 'admin'), listVisits);

/**
 * @swagger
 * /api/resident-visits/{visitId}/approve:
 *   patch:
 *     summary: Approve a pending visit request (Manager/Admin)
 *     tags: [Staff - Resident Visit]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: visitId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Approved }
 *       400: { description: Cannot approve (wrong status) }
 *       404: { description: Not found }
 */
router.patch('/:visitId/approve', protect, authorize('admin'), approveVisit);

/**
 * @swagger
 * /api/resident-visits/{visitId}/reject:
 *   patch:
 *     summary: Reject a pending visit request with reason (Manager/Admin)
 *     tags: [Staff - Resident Visit]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: visitId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rejectionReason]
 *             properties:
 *               rejectionReason: { type: string }
 *     responses:
 *       200: { description: Rejected }
 *       400: { description: rejectionReason required, or wrong status }
 *       404: { description: Not found }
 */
router.patch('/:visitId/reject', protect, authorize('admin'), rejectVisit);

module.exports = router;

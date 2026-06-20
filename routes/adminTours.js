const express = require('express');
const router = express.Router();
const { adminListTours, adminGetTour, approveTour, rejectTour } = require('../controllers/facilityTourController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('admin'));

/**
 * @swagger
 * /api/admin/tours:
 *   get:
 *     summary: List all facility tour requests (Admin)
 *     tags: [Admin - Facility Tour]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, confirmed, completed, cancelled]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by contactName, contactPhone, or contactEmail
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
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
 *         description: Paginated list of all tour requests
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 */
router.get('/', adminListTours);

/**
 * @swagger
 * /api/admin/tours/{tourId}:
 *   get:
 *     summary: Get facility tour detail (Admin)
 *     tags: [Admin - Facility Tour]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tourId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tour detail including familyAccount info
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 *       404:
 *         description: Tour not found
 */
router.get('/:tourId', adminGetTour);

/**
 * @swagger
 * /api/admin/tours/{tourId}/approve:
 *   patch:
 *     summary: Approve a facility tour request (Admin)
 *     tags: [Admin - Facility Tour]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tourId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               confirmedTimeSlot:
 *                 type: string
 *                 description: Khung giờ xác nhận, VD "09:00-11:00"
 *               adminNotes:
 *                 type: string
 *                 description: Ghi chú của Admin
 *     responses:
 *       200:
 *         description: Tour approved, status set to confirmed
 *       400:
 *         description: Cannot approve with current status
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 *       404:
 *         description: Tour not found
 */
router.patch('/:tourId/approve', approveTour);

/**
 * @swagger
 * /api/admin/tours/{tourId}/reject:
 *   patch:
 *     summary: Reject a facility tour request with reason (Admin)
 *     tags: [Admin - Facility Tour]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tourId
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
 *               - rejectionReason
 *             properties:
 *               rejectionReason:
 *                 type: string
 *                 description: Lý do từ chối (bắt buộc)
 *     responses:
 *       200:
 *         description: Tour rejected, status set to cancelled
 *       400:
 *         description: rejectionReason required, or cannot reject with current status
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 *       404:
 *         description: Tour not found
 */
router.patch('/:tourId/reject', rejectTour);

module.exports = router;

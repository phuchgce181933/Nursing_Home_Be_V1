const express = require('express');
const router = express.Router();
const { scheduleTour, listTourHistory, cancelTour } = require('../controllers/facilityTourController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('family'));

/**
 * @swagger
 * /api/family/tours:
 *   post:
 *     summary: Schedule a facility tour (Family)
 *     tags: [Family - Facility Tour]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contactName
 *               - contactPhone
 *               - preferredDate
 *             properties:
 *               contactName:
 *                 type: string
 *                 description: Tên người liên hệ
 *               contactPhone:
 *                 type: string
 *                 description: Số điện thoại liên hệ
 *               contactEmail:
 *                 type: string
 *                 format: email
 *               preferredDate:
 *                 type: string
 *                 format: date
 *                 description: Ngày mong muốn tham quan (tương lai)
 *               preferredTimeSlot:
 *                 type: string
 *                 description: Khung giờ mong muốn, VD "08:00-10:00"
 *               numberOfVisitors:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 20
 *                 default: 1
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Tour scheduled successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 */
router.post('/', scheduleTour);

/**
 * @swagger
 * /api/family/tours:
 *   get:
 *     summary: View facility tour request history (Family)
 *     tags: [Family - Facility Tour]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, confirmed, completed, cancelled]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter preferredDate >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter preferredDate <= to
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
 *         description: Paginated tour history
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 */
router.get('/', listTourHistory);

/**
 * @swagger
 * /api/family/tours/{tourId}/cancel:
 *   patch:
 *     summary: Cancel a facility tour request (Family)
 *     tags: [Family - Facility Tour]
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
 *               cancellationReason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Tour cancelled successfully
 *       400:
 *         description: Cannot cancel (wrong status)
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 *       404:
 *         description: Tour request not found
 */
router.patch('/:tourId/cancel', cancelTour);

module.exports = router;

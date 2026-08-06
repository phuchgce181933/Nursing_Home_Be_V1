const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  listConsultationRequests,
  getConsultationRequest,
  updateConsultationRequest,
} = require('../controllers/consultationRequestController');

router.use(protect, authorize('admin'));

/**
 * @swagger
 * /api/admin/consultation-requests:
 *   get:
 *     summary: List all consultation requests (Admin)
 *     tags: [Admin - Consultation Request]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, in_progress, resolved, closed]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by fullName, phone, email, serviceInterest, subject, or message
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
 *         default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         default: 20
 *     responses:
 *       200:
 *         description: Paginated list of consultation requests
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 */
router.get('/', listConsultationRequests);

/**
 * @swagger
 * /api/admin/consultation-requests/{requestId}:
 *   get:
 *     summary: Get consultation request detail (Admin)
 *     tags: [Admin - Consultation Request]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Consultation request detail
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 *       404:
 *         description: Not found
 */
router.get('/:requestId', getConsultationRequest);

/**
 * @swagger
 * /api/admin/consultation-requests/{requestId}:
 *   patch:
 *     summary: Update consultation request status or notes (Admin)
 *     tags: [Admin - Consultation Request]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [open, in_progress, resolved, closed]
 *               adminNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Consultation request updated
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 *       404:
 *         description: Not found
 */
router.patch('/:requestId', updateConsultationRequest);

module.exports = router;

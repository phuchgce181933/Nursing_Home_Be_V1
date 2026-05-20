const express = require('express');
const router = express.Router();
const {
  submitAdmissionRequest,
  listAdmissionRequests,
  getAdmissionRequest,
  cancelAdmissionRequest,
} = require('../controllers/admissionController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('family'));

/**
 * @swagger
 * /api/family/admission-requests:
 *   get:
 *     summary: View admission request history (Family)
 *     tags: [Admission Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [new_request, consulting, assessing, contracting, checked_in, cancelled]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
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
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated admission request history
 */
router.get('/', listAdmissionRequests);

/**
 * @swagger
 * /api/family/admission-requests/{admissionId}:
 *   get:
 *     summary: Get admission request detail (Family)
 *     tags: [Admission Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: admissionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Admission request detail
 *       404:
 *         description: Not found
 */
router.get('/:admissionId', getAdmissionRequest);

/**
 * @swagger
 * /api/family/admission-requests/{admissionId}/cancel:
 *   patch:
 *     summary: Cancel admission request (Family)
 *     tags: [Admission Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: admissionId
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
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Request cancelled
 *       400:
 *         description: Cannot cancel
 *       404:
 *         description: Not found
 */
router.patch('/:admissionId/cancel', cancelAdmissionRequest);

/**
 * @swagger
 * /api/family/admission-requests:
 *   post:
 *     summary: Submit admission request (Family)
 *     tags: [Admission Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - applicant
 *             properties:
 *               residentId:
 *                 type: string
 *               applicant:
 *                 type: object
 *                 required:
 *                   - fullName
 *                   - relationshipToRequester
 *                 properties:
 *                   fullName:
 *                     type: string
 *                   dateOfBirth:
 *                     type: string
 *                     format: date
 *                   gender:
 *                     type: string
 *                   relationshipToRequester:
 *                     type: string
 *               preferredAdmissionDate:
 *                 type: string
 *                 format: date
 *               reasonForAdmission:
 *                 type: string
 *               notes:
 *                 type: string
 *               requestedByPhone:
 *                 type: string
 *     responses:
 *       201:
 *         description: Admission request created
 */
router.post('/', submitAdmissionRequest);

module.exports = router;

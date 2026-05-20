const express = require('express');
const router = express.Router();
const {
  adminListAdmissions,
  adminGetAdmission,
  approveAdmission,
  rejectAdmission,
} = require('../controllers/admissionController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('admin', 'manager'));

/**
 * @swagger
 * /api/admin/admission-requests:
 *   get:
 *     summary: List all admission requests (Admin)
 *     tags: [Admin - Admission Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [new_request, consulting, assessing, contracting, checked_in, cancelled]
 *       - in: query
 *         name: eligibilityStatus
 *         schema:
 *           type: string
 *           enum: [pending, eligible, not_eligible]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by requestCode, applicant name, citizenId, or phone
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by requestedAt >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by requestedAt <= to
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
 *         description: Paginated list of all admission requests
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 *       400:
 *         description: Invalid query parameter
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 */
router.get('/', adminListAdmissions);

/**
 * @swagger
 * /api/admin/admission-requests/{admissionId}:
 *   get:
 *     summary: Get admission request detail (Admin)
 *     tags: [Admin - Admission Management]
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
 *         description: Admission request detail including family account info
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 *       404:
 *         description: Admission request not found
 */
router.get('/:admissionId', adminGetAdmission);

/**
 * @swagger
 * /api/admin/admission-requests/{admissionId}/approve:
 *   patch:
 *     summary: Approve an admission request (Admin)
 *     tags: [Admin - Admission Management]
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
 *               assignedServicePackage:
 *                 type: string
 *                 description: Optional service package to assign
 *               notes:
 *                 type: string
 *                 description: Optional admin notes
 *     responses:
 *       200:
 *         description: Admission request approved, status moved to contracting
 *       400:
 *         description: Cannot approve with current status
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 *       404:
 *         description: Admission request not found
 */
router.patch('/:admissionId/approve', approveAdmission);

/**
 * @swagger
 * /api/admin/admission-requests/{admissionId}/reject:
 *   patch:
 *     summary: Reject an admission request with reason (Admin)
 *     tags: [Admin - Admission Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: admissionId
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
 *                 description: Reason for rejecting the admission request
 *     responses:
 *       200:
 *         description: Admission request rejected, status set to cancelled, eligibilityStatus to not_eligible
 *       400:
 *         description: rejectionReason is required, or cannot reject with current status
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 *       404:
 *         description: Admission request not found
 */
router.patch('/:admissionId/reject', rejectAdmission);

module.exports = router;

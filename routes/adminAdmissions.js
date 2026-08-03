const express = require('express');
const router = express.Router();
const {
  createWalkInAdmission,
  adminListAdmissions,
  adminGetAdmission,
  approveAdmission,
  rejectAdmission,
  assignServicePackage,
  createAdmissionContract,
  cancelAdmissionContract,
  changeContractServicePackage,
  checkInResident,
  extendAdmissionContract,
} = require('../controllers/admissionController');
const { protect, authorize } = require('../middleware/auth');
// Route protection is applied per-route below to support read access for doctors and nurses

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
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
 *         description: Filter by resident MongoDB ObjectId (for wizard pre-fill)

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
/**
 * @swagger
 * /api/admin/admission-requests/walk-in:
 *   post:
 *     summary: Create an admission request for a walk-in family (Admin/Manager)
 *     description: |
 *       For families who show up in person without a self-registered account.
 *       Provide requestedByEmail or requestedByPhone (or both) for the family
 *       contact — a family account is auto-created and the login credentials
 *       are emailed/texted to them once the admission is checked in.
 *     tags: [Admin - Admission Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [applicant, requestedByName]
 *             properties:
 *               applicant:
 *                 type: object
 *                 description: Elderly person's info (same shape as family self-submission)
 *               relationshipToRequester:
 *                 type: string
 *               requestedByName:
 *                 type: string
 *               requestedByEmail:
 *                 type: string
 *               requestedByPhone:
 *                 type: string
 *               preferredAdmissionDate:
 *                 type: string
 *                 format: date
 *               reasonForAdmission:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Walk-in admission request created
 *       400:
 *         description: Validation error
 */
router.post('/walk-in', protect, authorize('admin', 'manager'), createWalkInAdmission);

router.get('/', protect, authorize('admin', 'doctor', 'nurse'), adminListAdmissions);

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
router.get('/:admissionId', protect, authorize('admin', 'doctor', 'nurse'), adminGetAdmission);

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
router.patch('/:admissionId/approve', protect, authorize('admin'), approveAdmission);

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
router.patch('/:admissionId/reject', protect, authorize('admin'), rejectAdmission);



/**
 * @swagger
 * /api/admin/admission-requests/{admissionId}/assign-service-package:
 *   patch:
 *     summary: Assign a service package to an admission (UC-6.24)
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
 *               - servicePackageId
 *             properties:
 *               servicePackageId:
 *                 type: string
 *                 description: ID of the service package to assign
 *               contractDurationMonths:
 *                 type: integer
 *                 minimum: 1
 *                 description: Contract duration in months
 *               discountPercent:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Discount percent for the assigned service package
 *     responses:
 *       200:
 *         description: Service package assigned successfully
 *       400:
 *         description: Invalid package or admission status
 *       404:
 *         description: Admission or service package not found
 */
router.patch('/:admissionId/assign-service-package', protect, authorize('admin'), assignServicePackage);

/**
 * @swagger
 * /api/admin/admission-requests/{admissionId}/create-contract:
 *   patch:
 *     summary: Create admission contract (UC-6.25)
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
 *               - contractNumber
 *             properties:
 *               contractNumber:
 *                 type: string
 *                 description: Contract number
 *               contractStartDate:
 *                 type: string
 *                 format: date
 *               contractEndDate:
 *                 type: string
 *                 format: date
 *               contractDurationMonths:
 *                 type: integer
 *                 minimum: 1
 *                 description: Contract duration in months
 *               discountPercent:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Contract discount percent
 *               contractTerms:
 *                 type: string
 *                 description: Contract terms and conditions
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Contract created, status set to contracting
 *       400:
 *         description: Validation error or invalid status
 *       404:
 *         description: Admission not found
 */
router.patch('/:admissionId/create-contract', protect, authorize('admin'), createAdmissionContract);

router.patch('/:admissionId/cancel-contract', protect, authorize('admin'), cancelAdmissionContract);
router.patch('/:admissionId/change-contract-service-package', protect, authorize('admin'), changeContractServicePackage);

/**
 * @swagger
 * /api/admin/admission-requests/{admissionId}/check-in:
 *   patch:
 *     summary: Check-in resident (UC-6.26)
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
 *               bedId:
 *                 type: string
 *                 description: ID of the bed to assign
 *               roomId:
 *                 type: string
 *                 description: ID of the room to assign
 *     responses:
 *       200:
 *         description: Resident checked in, status set to checked_in. Resident record created/updated.
 *       400:
 *         description: Missing contract or invalid status
 *       404:
 *         description: Admission, bed, or room not found
 */
router.patch('/:admissionId/check-in', protect, authorize('admin'), checkInResident);

/**
 * @swagger
 * /api/admin/admission-requests/{admissionId}/extend-contract:
 *   patch:
 *     summary: Extend contract end date (Admin)
 *     tags: [Admin - Admission Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: admissionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Admission ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contractEndDate
 *             properties:
 *               contractEndDate:
 *                 type: string
 *                 format: date-time
 *                 description: New contract end date (ISO 8601 format)
 *     responses:
 *       200:
 *         description: Contract extended successfully
 *       400:
 *         description: Invalid data or date validation failed
 *       404:
 *         description: Admission not found
 */
router.patch('/:admissionId/extend-contract', protect, authorize('admin', 'manager'), extendAdmissionContract);

module.exports = router;

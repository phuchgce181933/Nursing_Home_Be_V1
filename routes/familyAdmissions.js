const express = require('express');
const router = express.Router();
const { submitAdmissionRequest } = require('../controllers/admissionController');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * /api/family/admission-requests:
 *   post:
 *     summary: Submit admission request (Family)
 *     description: Family submits a new admission or residency request for a relative.
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
 *                 description: Optional — existing resident linked to family account
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
 *                     enum: [male, female, other, unknown]
 *                   citizenId:
 *                     type: string
 *                   bloodType:
 *                     type: string
 *                   personalAddress:
 *                     type: string
 *                   relationshipToRequester:
 *                     type: string
 *                   allergies:
 *                     type: array
 *                     items:
 *                       type: string
 *                   chronicConditions:
 *                     type: array
 *                     items:
 *                       type: string
 *                   initialHealthCondition:
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
 *       400:
 *         description: Validation error
 *       403:
 *         description: Access denied
 *       409:
 *         description: Duplicate active request
 */
router.post('/', protect, authorize('family'), submitAdmissionRequest);

module.exports = router;

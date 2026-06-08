const express = require('express');
const router = express.Router();
const {
  preAdmissionConsultation,
  evaluateAdmissionEligibility,
} = require('../controllers/admissionController');
const { protect, authorize } = require('../middleware/auth');

// ── UC-6.16: Pre-admission Consultation (Doctor, Nurse) ────────────────────────

/**
 * @swagger
 * /api/medical/admission-requests/{admissionId}/consultation:
 *   patch:
 *     summary: Record pre-admission consultation (UC-6.16)
 *     tags: [Medical - Admission Management]
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
 *               - consultationNotes
 *             properties:
 *               consultationNotes:
 *                 type: string
 *                 description: Notes from the pre-admission consultation
 *               notes:
 *                 type: string
 *                 description: Optional general notes
 *     responses:
 *       200:
 *         description: Pre-admission consultation recorded, status moved to consulting
 *       400:
 *         description: Validation error or invalid status
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 *       404:
 *         description: Admission request not found
 */
router.patch(
  '/:admissionId/consultation',
  protect,
  authorize('doctor', 'nurse'),
  preAdmissionConsultation
);



// ── UC-6.19: Evaluate Admission Eligibility (Doctor only) ──────────────────────

/**
 * @swagger
 * /api/medical/admission-requests/{admissionId}/evaluate-eligibility:
 *   patch:
 *     summary: Evaluate admission eligibility (UC-6.19)
 *     tags: [Medical - Admission Management]
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
 *               - eligibilityStatus
 *               - assessmentResult
 *             properties:
 *               eligibilityStatus:
 *                 type: string
 *                 enum: [pending, eligible, not_eligible]
 *                 description: Result of eligibility evaluation
 *               assessmentResult:
 *                 type: string
 *                 description: Detailed assessment result
 *               rejectionReason:
 *                 type: string
 *                 description: Reason for not_eligible (optional, auto-generated if not provided)
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Eligibility evaluated. If not_eligible, admission is cancelled.
 *       400:
 *         description: Validation error or invalid status
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden (doctor only)
 *       404:
 *         description: Admission request not found
 */
router.patch(
  '/:admissionId/evaluate-eligibility',
  protect,
  authorize('doctor'),
  evaluateAdmissionEligibility
);

module.exports = router;

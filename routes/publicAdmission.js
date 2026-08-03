const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { submitGuestAdmissionRequest } = require('../controllers/admissionController');

// Anonymous visitor submits an admission request; the account is created and login
// credentials are emailed/texted immediately. Rate-limited per IP since this creates
// real accounts and sends real email/SMS (mirrors guestCreationLimiter in routes/conversations.js).
const guestAdmissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Quá nhiều yêu cầu tiếp nhận từ địa chỉ IP này, vui lòng thử lại sau' },
});

/**
 * @swagger
 * /api/public/admission-requests:
 *   post:
 *     tags:
 *       - Public Admission
 *     summary: Submit an admission request as an anonymous visitor (no auth). A family account is created and login credentials are emailed/texted immediately.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - applicant
 *               - requestedByName
 *             properties:
 *               applicant:
 *                 type: object
 *                 required:
 *                   - fullName
 *                   - relationshipToRequester
 *                 properties:
 *                   fullName: { type: string }
 *                   relationshipToRequester: { type: string }
 *                   dateOfBirth: { type: string, format: date }
 *                   gender: { type: string }
 *               preferredAdmissionDate: { type: string, format: date }
 *               reasonForAdmission: { type: string }
 *               notes: { type: string }
 *               requestedByName: { type: string }
 *               requestedByPhone: { type: string }
 *               requestedByEmail: { type: string }
 *     responses:
 *       201:
 *         description: Admission request submitted; credentials sent by email/SMS
 *       400:
 *         description: Validation error
 *       409:
 *         description: An account already exists for this email/phone
 */
router.post('/', guestAdmissionLimiter, submitGuestAdmissionRequest);

module.exports = router;

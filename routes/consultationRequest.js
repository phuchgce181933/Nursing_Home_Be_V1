const express = require('express');
const router = express.Router();
const { submitConsultationRequest } = require('../controllers/consultationRequestController');

/**
 * @swagger
 * /api/consultation-requests:
 *   post:
 *     summary: Submit a consultation request (Public)
 *     tags: [Consultation Request]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullName
 *               - phone
 *             properties:
 *               fullName:
 *                 type: string
 *               age:
 *                 type: integer
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               address:
 *                 type: string
 *               serviceInterest:
 *                 type: string
 *               subject:
 *                 type: string
 *               message:
 *                 type: string
 *     responses:
 *       201:
 *         description: Consultation request created
 *       400:
 *         description: Validation error
 */
router.post('/', submitConsultationRequest);

module.exports = router;

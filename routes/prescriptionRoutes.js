const express = require('express');
const router = express.Router();
const { createPrescription } = require('../controllers/prescriptionController');
const { protect, authorize } = require('../middleware/auth');
const { createPrescriptionRules, validate } = require('../validators/prescriptionValidator');

/**
 * @swagger
 * /api/prescriptions:
 *   post:
 *     summary: Create a prescription with medication safety checks (Doctor only)
 *     tags: [Prescriptions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [residentId, diagnosisNote, validUntil, items]
 *             properties:
 *               residentId:
 *                 type: string
 *                 example: "64f1a2b3c4d5e6f7a8b9c0d1"
 *               diagnosisNote:
 *                 type: string
 *                 minLength: 10
 *                 example: "Bệnh nhân cao huyết áp giai đoạn 2, cần kiểm soát huyết áp"
 *               validUntil:
 *                 type: string
 *                 format: date-time
 *                 description: "Max 30 ngày kể từ hôm nay (Thông tư 52/2017/TT-BYT)"
 *                 example: "2025-06-20T00:00:00.000Z"
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [medicationName, dosage, frequency]
 *                   properties:
 *                     medicationName:
 *                       type: string
 *                       example: "Amlodipine"
 *                     dosage:
 *                       type: number
 *                       example: 5
 *                     unit:
 *                       type: string
 *                       example: "mg"
 *                     frequency:
 *                       type: integer
 *                       minimum: 1
 *                       maximum: 4
 *                       example: 1
 *                     times:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["08:00"]
 *                     route:
 *                       type: string
 *                       enum: [oral, injection, topical, inhaled]
 *                       example: "oral"
 *                     duration:
 *                       type: integer
 *                       example: 30
 *                     startDate:
 *                       type: string
 *                       format: date
 *                       example: "2025-06-01"
 *                     endDate:
 *                       type: string
 *                       format: date
 *                       example: "2025-07-01"
 *                     instructions:
 *                       type: string
 *                       example: "Uống sau ăn sáng"
 *               acknowledgeWarnings:
 *                 type: boolean
 *                 description: "Gửi true để xác nhận bỏ qua cảnh báo nghiêm trọng (SEVERE/HIGH/CRITICAL)"
 *                 example: false
 *     responses:
 *       201:
 *         description: Prescription created (warnings[] may still be present)
 *       400:
 *         description: |
 *           VALIDATION_ERROR — invalid input fields
 *           ALLERGY — drug matches resident allergy (hard block)
 *           REQUIRES_ACKNOWLEDGMENT — SEVERE/HIGH/CRITICAL warnings found, set acknowledgeWarnings:true to proceed
 *       403:
 *         description: Doctor role required
 *       404:
 *         description: Resident not found
 */
router.post(
  '/',
  protect,
  authorize('doctor'),
  createPrescriptionRules,
  validate,
  createPrescription
);

module.exports = router;

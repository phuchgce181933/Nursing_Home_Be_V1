const express = require('express');
const router = express.Router();
const {
  createPrescription,
  editPrescription,
  listPrescriptions,
  getPrescription,
  estimatePrescriptionCost,
  activatePrescription,
  suspendPrescription,
  resumePrescription,
} = require('../controllers/prescriptionController');
const { protect, authorize } = require('../middleware/auth');
const {
  createPrescriptionRules,
  editPrescriptionRules,
  validate,
} = require('../validators/prescriptionValidator');

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
 *                 description: "Gửi true để xác nhận bỏ qua cảnh báo nghiêm trọng"
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

/**
 * @swagger
 * /api/prescriptions:
 *   get:
 *     summary: List prescriptions for a resident (Doctor or Nurse)
 *     tags: [Prescriptions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *         description: "Resident ObjectId (required)"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, COMPLETED, CANCELLED]
 *         description: "Filter by status"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Paginated list with itemsCount and activeItemsCount per prescription
 *       400:
 *         description: residentId is required
 *       403:
 *         description: Doctor or Nurse role required
 */
router.get('/', protect, authorize('doctor', 'nurse', 'admin'), listPrescriptions);

/**
 * @swagger
 * /api/prescriptions/{id}:
 *   get:
 *     summary: Get a single prescription with compliance rate (Doctor or Nurse)
 *     tags: [Prescriptions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Prescription with complianceRate (null if no schedule data yet)
 *       403:
 *         description: Doctor or Nurse role required
 *       404:
 *         description: Prescription not found
 */
router.get('/:id', protect, authorize('doctor', 'nurse', 'admin'), getPrescription);

router.get('/:id/estimate-cost', protect, authorize('doctor', 'nurse', 'admin'), estimatePrescriptionCost);

router.patch('/:id/activate', protect, authorize('doctor'), activatePrescription);
router.patch('/:id/suspend', protect, authorize('doctor'), suspendPrescription);
router.patch('/:id/resume', protect, authorize('doctor'), resumePrescription);

/**
 * @swagger
 * /api/prescriptions/{id}:
 *   put:
 *     summary: Edit an ACTIVE prescription (Doctor or Nurse)
 *     tags: [Prescriptions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: |
 *               Doctor can send: diagnosisNote, validUntil, items[] (full replacement), acknowledgeWarnings.
 *               Nurse can send only: items[] with _id + instructions and/or times.
 *             properties:
 *               diagnosisNote:
 *                 type: string
 *                 minLength: 10
 *               validUntil:
 *                 type: string
 *                 format: date-time
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                       description: "Required for Nurse edits (identifies item to patch)"
 *                     medicationName:
 *                       type: string
 *                     dosage:
 *                       type: number
 *                     unit:
 *                       type: string
 *                     frequency:
 *                       type: integer
 *                     times:
 *                       type: array
 *                       items:
 *                         type: string
 *                     route:
 *                       type: string
 *                       enum: [oral, injection, topical, inhaled]
 *                     instructions:
 *                       type: string
 *               acknowledgeWarnings:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Updated prescription (warnings[] present if safety checks triggered)
 *       400:
 *         description: VALIDATION_ERROR / ALLERGY / REQUIRES_ACKNOWLEDGMENT / no changes detected
 *       403:
 *         description: Doctor or Nurse role required
 *       404:
 *         description: Prescription not found
 */
router.put(
  '/:id',
  protect,
  authorize('doctor', 'nurse'),
  editPrescriptionRules,
  validate,
  editPrescription
);

module.exports = router;

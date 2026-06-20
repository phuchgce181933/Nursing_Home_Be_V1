const express = require('express');
const router = express.Router({ mergeParams: true });
const { recordVitals, getHistory } = require('../controllers/medicalRecordController');
const { protect, authorize } = require('../middleware/auth');

const STAFF_ROLES = ['admin', 'doctor', 'nurse'];
const VIEW_ROLES = ['admin', 'doctor', 'nurse', 'family'];

/**
 * @swagger
 * /api/residents/{residentId}/medical-records:
 *   post:
 *     summary: Record resident vital signs & health indicators (UC-9)
 *     tags: [Medical Records]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               bloodPressureSystolic:
 *                 type: number
 *               bloodPressureDiastolic:
 *                 type: number
 *               pulse:
 *                 type: number
 *               temperatureCelsius:
 *                 type: number
 *               oxygenSaturation:
 *                 type: number
 *               bloodSugar:
 *                 type: number
 *               weightKg:
 *                 type: number
 *               heightCm:
 *                 type: number
 *               physicalExamination:
 *                 type: string
 *               laboratoryTestResults:
 *                 type: string
 *               urinalysisResults:
 *                 type: string
 *               ecgResults:
 *                 type: string
 *               imagingResults:
 *                 type: string
 *               cognitiveFunction:
 *                 type: string
 *               functionalStatus:
 *                 type: string
 *               fallRisk:
 *                 type: string
 *               nutritionalStatus:
 *                 type: string
 *               roomCost:
 *                 type: number
 *               medicationCost:
 *                 type: number
 *               careServiceCost:
 *                 type: number
 *               otherCost:
 *                 type: number
 *               paymentMethod:
 *                 type: string
 *                 enum: [bank_transfer, card, wallet, cash]
 *               consentToPayment:
 *                 type: boolean
 *               summary:
 *                 type: string
 *               bloodType:
 *                 type: string
 *                 enum: [A+, A-, B+, B-, AB+, AB-, O+, O-, unknown]
 *     responses:
 *       201:
 *         description: Vitals signs saved successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Resident not found
 */
router.post('/', protect, authorize('doctor', 'nurse'), recordVitals);

/**
 * @swagger
 * /api/residents/{residentId}/medical-records:
 *   get:
 *     summary: Fetch vital logs history for a resident
 *     tags: [Medical Records]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
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
 *         description: List of historical vital signs
 *       404:
 *         description: Resident not found
 */
router.get('/', protect, authorize(...VIEW_ROLES), getHistory);

module.exports = router;

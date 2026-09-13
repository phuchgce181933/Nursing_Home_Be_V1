const express = require('express');
const router = express.Router({ mergeParams: true });
const { createContract } = require('../controllers/contractController');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * /api/admin/admission-contracts/from-admission/{admissionId}:
 *   post:
 *     summary: Create contract from admission (UC-210) - After doctor completes evaluation
 *     description: |
 *       Creates a new contract for an admission that has been evaluated by doctor.
 *       Flow: Doctor khám → status='contracting' → Admin tạo hợp đồng
 *       
 *       Admission must be in 'assessing' or 'contracting' status.
 *       Service package must have been assigned before this step.
 *     tags: [Admin - Contract Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: admissionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contractNumber:
 *                 type: string
 *                 description: Auto-generated if not provided
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 *               durationMonths:
 *                 type: integer
 *                 minimum: 1
 *               discountPercent:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *               terms:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Contract created successfully, admission status updated to 'contracting'
 *       400:
 *         description: Invalid data or admission in wrong status
 *       404:
 *         description: Admission not found
 *       409:
 *         description: Admission already has an active contract
 */
router.post('/from-admission/:admissionId', protect, authorize('admin'), createContract);

module.exports = router;

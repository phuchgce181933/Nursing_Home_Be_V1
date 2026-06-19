const express = require('express');
const { protect, optionalProtect, authorize } = require('../middleware/auth');
const paymentController = require('../controllers/paymentController');

const router = express.Router({ mergeParams: true });

/**
 * @swagger
 * /api/residents/{residentId}/invoices:
 *   post:
 *     summary: Create an invoice for a resident and optionally attach it to a medical exam record
 *     tags: [Billing]
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
 *               roomCost:
 *                 type: number
 *               medicationCost:
 *                 type: number
 *               careServiceCost:
 *                 type: number
 *               otherCost:
 *                 type: number
 *               prescriptionId:
 *                 type: string
 *                 description: Attach a doctor prescription to calculate medication billing
 *               paymentMethod:
 *                 type: string
 *                 enum: [bank_transfer, card, wallet, cash]
 *               consentToPayment:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Invoice created successfully
 */

router.post('/', protect, authorize('doctor', 'nurse', 'admin', 'family'), paymentController.createInvoice);
router.get('/', protect, authorize('doctor', 'nurse', 'admin', 'resident', 'family'), paymentController.listInvoices);
router.post('/batch-pay', protect, authorize('family', 'admin'), paymentController.batchPayment);
router.get('/payos/checkout/:invoiceId', optionalProtect, paymentController.getPayosCheckoutPage);
router.get('/:invoiceId', protect, authorize('doctor', 'nurse', 'admin', 'resident', 'family'), paymentController.getInvoice);
router.post('/:invoiceId/pay', protect, authorize('doctor', 'nurse', 'admin', 'family'), paymentController.recordPayment);

module.exports = router;

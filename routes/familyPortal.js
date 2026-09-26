const express = require('express');
const router = express.Router();
const {
  getResidents,
  getResident,
  getResidentBillingSummary,
  getResidentInvoices,
  getPaymentHistory,
  getInvoicePaymentUrl,
  getInvoiceDetail,
  getWalletBalance,
  generateWalletTopupUrl,
  confirmWalletTopup,
  verifyWalletTopup,
  getWalletTopupCheckoutPage,
  getVitals,
  getHealthHistory,
  getHealthChart,
  getCareNotes,
  getMedications,
  getMedicationHistory,
  getDailyMedicationSchedule,
  getPrescriptions,
  getActivities,
  getCareAppointments,
  getHealthReport,
  getDailyActivities,
  getCareSchedule,
  downloadReport,
} = require('../controllers/familyPortalController');
const { initiateWalletPayment, verifyWalletPayment } = require('../controllers/familyPaymentController');
const { protect, authorize } = require('../middleware/auth');

// Public checkout endpoints (no auth required - use checksum verification instead)
router.get('/wallet/topup/payos/checkout/:topupId', getWalletTopupCheckoutPage);

// Proxy QR image from PayOS to avoid CORS on mobile/web
router.get('/wallet/qr-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).json({ message: 'url là bắt buộc' });
  try {
    const https = require('https');
    const http = require('http');
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (upstream) => {
      res.set('Content-Type', upstream.headers['content-type'] || 'image/png');
      res.set('Cache-Control', 'public, max-age=600');
      upstream.pipe(res);
    }).on('error', () => res.status(502).json({ message: 'Không thể tải mã QR' }));
  } catch {
    res.status(502).json({ message: 'Không thể tải mã QR' });
  }
});

// Protected routes - require authentication
router.use(protect, authorize('family'));

/**
 * @swagger
 * /api/family/residents:
 *   get:
 *     summary: Get all residents linked to the logged-in family account
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of linked residents
 */
router.get('/residents', getResidents);

/**
 * @swagger
 * /api/family/residents/{residentId}:
 *   get:
 *     summary: Get resident details
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resident details
 *       403:
 *         description: Access denied
 *       404:
 *         description: Resident not found
 */
router.get('/residents/:residentId', getResident);

/**
 * @swagger
 * /api/family/residents/{residentId}/billing-summary:
 *   get:
 *     summary: Get billing summary for a resident, including latest invoice and registered service package
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resident billing summary
 *       403:
 *         description: Access denied
 *       404:
 *         description: Resident not found
 */
router.get('/residents/:residentId/billing-summary', getResidentBillingSummary);

/**
 * @swagger
 * /api/family/residents/{residentId}/payment-history:
 *   get:
 *     summary: Get payment history for a resident — wallet topups and paid invoices
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment history with wallet topups and invoice payments
 *       403:
 *         description: Access denied
 *       404:
 *         description: Resident not found
 */
router.get('/residents/:residentId/payment-history', getPaymentHistory);

/**
 * @swagger
 * /api/family/residents/{residentId}/invoices:
 *   get:
 *     summary: Get invoices for a resident
 *     tags: [Family Portal]
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
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated invoices
 *       403:
 *         description: Access denied
 *       404:
 *         description: Resident not found
 */
router.get('/residents/:residentId/invoices', getResidentInvoices);

/**
 * @swagger
 * /api/family/residents/{residentId}/invoices/{invoiceId}/payment-url:
 *   get:
 *     summary: Get PayOS payment URL for an invoice (for mobile app)
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment URL with checksum
 *       403:
 *         description: Access denied
 *       404:
 *         description: Invoice not found
 */
router.get('/residents/:residentId/invoices/:invoiceId/payment-url', getInvoicePaymentUrl);

/**
 * @swagger
 * /api/family/residents/{residentId}/invoices/{invoiceId}:
 *   get:
 *     summary: Get invoice details for preview
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Invoice details
 *       403:
 *         description: Access denied
 *       404:
 *         description: Invoice not found
 */
router.get('/residents/:residentId/invoices/:invoiceId', getInvoiceDetail);

/**
 * @swagger
 * /api/family/wallet/balance:
 *   get:
 *     summary: Get wallet balance for logged-in family member
 *     tags: [Family Wallet]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet balance information
 *         schema:
 *           type: object
 *           properties:
 *             balance:
 *               type: number
 *               description: Current wallet balance
 *             totalTopup:
 *               type: number
 *               description: Total amount topped up
 *             totalSpent:
 *               type: number
 *               description: Total amount spent
 */
router.get('/wallet/balance', getWalletBalance);

/**
 * @swagger
 * /api/family/wallet/topup:
 *   post:
 *     summary: Generate payment URL for wallet topup
 *     tags: [Family Wallet]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 100000
 *                 description: Amount to topup in VND
 *     responses:
 *       200:
 *         description: Payment URL with checksum for topup
 *       400:
 *         description: Invalid amount
 */
router.post('/wallet/topup', generateWalletTopupUrl);

/**
 * @swagger
 * /api/family/wallet/topup/confirm:
 *   post:
 *     summary: Confirm wallet topup after successful payment
 *     tags: [Family Wallet]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 100000
 *                 description: Amount that was topped up in VND
 *     responses:
 *       200:
 *         description: Topup confirmed, wallet updated
 *       400:
 *         description: Invalid request
 */
router.post('/wallet/topup/confirm', confirmWalletTopup);
router.post('/wallet/topup/verify', verifyWalletTopup);

/**
 * Wallet payment with OTP
 */
router.post('/wallet/payments/initiate', initiateWalletPayment);
router.post('/wallet/payments/verify', verifyWalletPayment);

/**
 * @swagger
 * /api/family/residents/{residentId}/vitals:
 *   get:
 *     summary: Get latest vitals record for a resident
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Latest vitals record (or null if none)
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/vitals', getVitals);

/**
 * @swagger
 * /api/family/residents/{residentId}/health-history:
 *   get:
 *     summary: Get paginated medical record history
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter measuredAt >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter measuredAt <= to
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in summary text
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
 *     responses:
 *       200:
 *         description: Paginated medical records
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/health-history', getHealthHistory);

/**
 * @swagger
 * /api/family/residents/{residentId}/health-chart:
 *   get:
 *     summary: Get time-series vitals data for charting (default last 30 days)
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [bloodPressureSystolic, bloodPressureDiastolic, pulse, temperatureCelsius, oxygenSaturation, bloodSugar, weightKg]
 *         description: Specific metric to return (returns all metrics if omitted)
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Time-series vitals array
 *       400:
 *         description: Invalid metric value
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/health-chart', getHealthChart);

/**
 * @swagger
 * /api/family/residents/{residentId}/care-notes:
 *   get:
 *     summary: Get paginated care notes for a resident
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: noteType
 *         schema:
 *           type: string
 *           enum: [meal, activity, health, general]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in note content
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
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
 *     responses:
 *       200:
 *         description: Paginated care notes
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/care-notes', getCareNotes);

/**
 * @swagger
 * /api/family/residents/{residentId}/medications:
 *   get:
 *     summary: Get paginated medication schedule records for a resident
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, TAKEN, LATE_TAKEN, MISSED, SKIPPED]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledTime >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledTime <= to
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
 *     responses:
 *       200:
 *         description: Paginated medication schedule records
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/medications', getMedications);

/**
 * @swagger
 * /api/family/residents/{residentId}/medication-history:
 *   get:
 *     summary: Get medication administration history with compliance stats for a resident
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledTime >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledTime <= to
 *     responses:
 *       200:
 *         description: Medication history with compliance stats
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/medication-history', getMedicationHistory);

/**
 * @swagger
 * /api/family/residents/{residentId}/daily-medication-schedule:
 *   get:
 *     summary: Get daily medication schedule for a resident (today's doses)
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-06-04"
 *         description: Single date (YYYY-MM-DD). Defaults to today.
 *     responses:
 *       200:
 *         description: Daily medication schedule with doses
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/daily-medication-schedule', getDailyMedicationSchedule);

/**
 * @swagger
 * /api/family/residents/{residentId}/prescriptions:
 *   get:
 *     summary: Get prescriptions for a resident
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, COMPLETED, CANCELLED]
 *     responses:
 *       200:
 *         description: List of prescriptions (sorted by prescriptionDate desc)
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/prescriptions', getPrescriptions);

/**
 * @swagger
 * /api/family/residents/{residentId}/activities:
 *   get:
 *     summary: Get activities the resident participates in
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, scheduled, ongoing, completed, cancelled]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledAt >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledAt <= to
 *     responses:
 *       200:
 *         description: List of activities
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/activities', getActivities);

/**
 * @swagger
 * /api/family/residents/{residentId}/care-appointments:
 *   get:
 *     summary: Get care appointments for a resident
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [scheduled, in_progress, completed, cancelled]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledStartAt >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledStartAt <= to
 *     responses:
 *       200:
 *         description: List of care appointments
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/care-appointments', getCareAppointments);

/**
 * @swagger
 * /api/family/residents/{residentId}/report:
 *   get:
 *     summary: Get comprehensive health report for a resident
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Report period start (no filter if omitted)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Report period end (no filter if omitted)
 *     responses:
 *       200:
 *         description: Health report with vitals, care notes, appointments, medications
 *       403:
 *         description: Access denied
 *       404:
 *         description: Resident not found
 */
router.get('/residents/:residentId/report', getHealthReport);

/**
 * @swagger
 * /api/family/residents/{residentId}/report/download:
 *   get:
 *     summary: Download comprehensive health report as CSV file
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Report period start (no filter if omitted)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Report period end (no filter if omitted)
 *     responses:
 *       200:
 *         description: CSV file download containing vitals, care notes, medications, appointments
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *       403:
 *         description: Access denied
 *       404:
 *         description: Resident not found
 */
router.get('/residents/:residentId/report/download', downloadReport);

/**
 * @swagger
 * /api/family/residents/{residentId}/daily-activities:
 *   get:
 *     summary: Get daily activity schedule - care tasks, hygiene, meals, and behavior records
 *     description: Returns care tasks, hygiene activity records, meal intake notes, and daily behavior observations for the specified date or date range. Defaults to today if no date parameters provided.
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-06-04"
 *         description: Single date (YYYY-MM-DD). Takes priority over from/to.
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start of date range (used when date is not provided)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End of date range (used when date is not provided)
 *     responses:
 *       200:
 *         description: Daily activities grouped into careTasks, hygieneRecords, mealIntakeNotes, behaviorRecords
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/daily-activities', getDailyActivities);

/**
 * @swagger
 * /api/family/residents/{residentId}/care-schedule:
 *   get:
 *     summary: Get planned care schedule entries for the resident
 *     description: Returns published care schedule days with their entries (planned care tasks) for the specified date or date range. Defaults to today if no date parameters provided.
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-06-04"
 *         description: Single date (YYYY-MM-DD). Takes priority over from/to.
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start of date range (used when date is not provided)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End of date range (used when date is not provided)
 *     responses:
 *       200:
 *         description: Array of care schedule days, each with an entries array containing the planned care tasks
 *       403:
 *         description: Access denied
 */
router.get('/residents/:residentId/care-schedule', getCareSchedule);

module.exports = router;

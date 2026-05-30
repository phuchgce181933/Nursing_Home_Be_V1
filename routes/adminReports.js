const express = require('express');
const router = express.Router();
const {
  residentCountReport,
  summaryReport,
  healthStatusReport,
  incidentReport,
  careActivityReport,
  financialReport,
  timeSeriesReport,
  comparisonReport,
  exportReport,
  saveReportHistory,
  listReportHistory,
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('admin'));

/**
 * @swagger
 * /api/admin/reports/resident-count:
 *   get:
 *     summary: Get resident count report (Admin)
 *     tags: [Admin - Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: residencyStatus
 *         schema:
 *           type: string
 *       - in: query
 *         name: servicePackage
 *         schema:
 *           type: string
 *       - in: query
 *         name: roomId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resident count report retrieved
 */
router.get('/resident-count', residentCountReport);

/**
 * @swagger
 * /api/admin/reports/summary:
 *   get:
 *     summary: Get summary report for the nursing home (Admin)
 *     tags: [Admin - Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
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
 *         description: Summary report retrieved
 */
router.get('/summary', summaryReport);

/**
 * @swagger
 * /api/admin/reports/health-status:
 *   get:
 *     summary: Get health status report for residents (Admin)
 *     tags: [Admin - Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
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
 *         description: Health status report retrieved
 */
router.get('/health-status', healthStatusReport);

/**
 * @swagger
 * /api/admin/reports/incidents:
 *   get:
 *     summary: List and view incident reports (Admin)
 *     tags: [Admin - Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *       - in: query
 *         name: incidentType
 *         schema:
 *           type: string
 *       - in: query
 *         name: incidentFrom
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: incidentTo
 *         schema:
 *           type: string
 *           format: date-time
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
 *         description: Incident report list retrieved
 */
router.get('/incidents', incidentReport);

/**
 * @swagger
 * /api/admin/reports/care-activity:
 *   get:
 *     summary: Get care activity report and task statistics (Admin)
 *     tags: [Admin - Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: taskType
 *         schema:
 *           type: string
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
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
 *         description: Care activity report retrieved
 */
router.get('/care-activity', careActivityReport);

/**
 * @swagger
 * /api/admin/reports/financial:
 *   get:
 *     summary: Get financial report and billing statistics (Admin)
 *     tags: [Admin - Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
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
 *         name: dueFrom
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: dueTo
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Financial report retrieved
 */
router.get('/financial', financialReport);

/**
 * @swagger
 * /api/admin/reports/time-series:
 *   get:
 *     summary: Get time series report for KPI charts (Admin)
 *     tags: [Admin - Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [incidents, residentAdmissions, activities, invoiceRevenue, payments]
 *       - in: query
 *         name: granularity
 *         schema:
 *           type: string
 *           enum: [day, week, month]
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
 *         description: Time series report retrieved
 */
router.get('/time-series', timeSeriesReport);

/**
 * @swagger
 * /api/admin/reports/compare:
 *   get:
 *     summary: Compare report data over time (Admin)
 *     tags: [Admin - Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [incidents, residentAdmissions, activities, invoiceRevenue, payments]
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Comparison report retrieved
 */
router.get('/compare', comparisonReport);

/**
 * @swagger
 * /api/admin/reports/export:
 *   get:
 *     summary: Export report data as CSV (Admin)
 *     tags: [Admin - Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [incidents, resident-count, financial, compare, residentAdmissions, activities, invoiceRevenue, payments]
 *     responses:
 *       200:
 *         description: CSV file returned for download
 */
router.get('/export', exportReport);

/**
 * @swagger
 * /api/admin/reports/history:
 *   get:
 *     summary: List saved report history snapshots (Admin)
 *     tags: [Admin - Reporting]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: reportType
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
 *         description: Report history list retrieved
 */
router.get('/history', listReportHistory);

/**
 * @swagger
 * /api/admin/reports/history:
 *   post:
 *     summary: Save a report snapshot to history (Admin)
 *     tags: [Admin - Reporting]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reportType, title]
 *             properties:
 *               reportType:
 *                 type: string
 *               title:
 *                 type: string
 *               filters:
 *                 type: object
 *               periodStart:
 *                 type: string
 *                 format: date-time
 *               periodEnd:
 *                 type: string
 *                 format: date-time
 *               summaryMetrics:
 *                 type: object
 *               chartData:
 *                 type: object
 *               exportedFileUrl:
 *                 type: string
 *     responses:
 *       201:
 *         description: Report snapshot saved successfully
 */
router.post('/history', saveReportHistory);

module.exports = router;

const express = require('express');
const router = express.Router();

router.use('/admission-requests', require('./adminAdmissions'));
router.use('/admission-contracts', require('./adminAdmissionContracts'));
router.use('/contracts', require('./adminContracts'));
router.use('/tours', require('./adminTours'));
router.use('/service-packages', require('./adminServicePackages'));
router.use('/residents', require('./adminResidents'));
router.use('/invoices', require('./adminInvoices'));
router.use('/activities', require('./adminActivities'));
router.use('/reports', require('./adminReports'));
router.use('/audit-logs', require('./adminAuditLogs'));
router.use('/meal-intake-notes', require('./adminMealIntakeNotes'));
router.use('/hygiene-activities', require('./adminHygieneActivities'));
router.use('/daily-behaviors', require('./adminDailyBehaviors'));
router.use('/conversations', require('./conversations'));

module.exports = router;

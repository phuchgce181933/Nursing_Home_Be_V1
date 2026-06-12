const express = require('express');
const router = express.Router();

router.use('/admission-requests', require('./adminAdmissions'));
router.use('/tours', require('./adminTours'));
router.use('/service-packages', require('./adminServicePackages'));
router.use('/residents', require('./adminResidents'));
router.use('/activities', require('./adminActivities'));
router.use('/reports', require('./adminReports'));
router.use('/conversations', require('./conversations'));

module.exports = router;

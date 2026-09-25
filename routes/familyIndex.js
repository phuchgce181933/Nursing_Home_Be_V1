const express = require('express');
const router = express.Router();

router.use('/admission-requests', require('./familyAdmissions'));
router.use('/tours', require('./familyTours'));
router.use('/visits', require('./familyVisits'));
router.use('/support-requests', require('./familySupportRequests'));
router.use('/conversations', require('./conversations'));
router.use('/', require('./familyPortal'));
router.use('/notifications', require('./familyNotifications'));

module.exports = router;

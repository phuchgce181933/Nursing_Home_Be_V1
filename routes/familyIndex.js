const express = require('express');
const router = express.Router();

router.use('/admission-requests', require('./familyAdmissions'));
router.use('/tours', require('./familyTours'));
router.use('/support-requests', require('./familySupportRequests'));
router.use('/', require('./familyPortal'));

module.exports = router;

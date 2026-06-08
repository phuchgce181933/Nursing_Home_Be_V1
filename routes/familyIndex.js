const express = require('express');
const router = express.Router();

router.use('/admission-requests', require('./familyAdmissions'));
router.use('/tours', require('./familyTours'));
router.use('/', require('./familyPortal'));
router.use('/support-requests', require('./familySupportRequests'));

module.exports = router;

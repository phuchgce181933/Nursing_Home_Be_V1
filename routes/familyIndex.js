const express = require('express');
const router = express.Router();

router.use('/admission-requests', require('./familyAdmissions'));
router.use('/tours', require('./familyTours'));
router.use('/support-requests', require('./familySupportRequests'));
// Mount conversations before the catch-all family portal to allow public guest routes
router.use('/conversations', require('./conversations'));
router.use('/', require('./familyPortal'));

module.exports = router;

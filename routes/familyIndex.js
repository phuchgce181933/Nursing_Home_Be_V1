const express = require('express');
const router = express.Router();

router.use('/admission-requests', require('./familyAdmissions'));
router.use('/', require('./familyPortal'));

module.exports = router;

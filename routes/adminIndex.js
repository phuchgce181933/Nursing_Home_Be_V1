const express = require('express');
const router = express.Router();

router.use('/admission-requests', require('./adminAdmissions'));
router.use('/tours', require('./adminTours'));
router.use('/service-packages', require('./adminServicePackages'));

module.exports = router;

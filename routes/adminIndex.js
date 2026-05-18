const express = require('express');
const router = express.Router();

router.use('/admission-requests', require('./adminAdmissions'));

module.exports = router;

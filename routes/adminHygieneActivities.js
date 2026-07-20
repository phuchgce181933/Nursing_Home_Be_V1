const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/hygieneActivityController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('admin'));

router.get('/', ctrl.adminListRecords);

module.exports = router;

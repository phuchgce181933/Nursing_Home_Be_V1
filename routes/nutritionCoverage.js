const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/nutritionCoverageController');
const { protect, authorize } = require('../middleware/auth');

const NURSE_ROLES = ['nurse'];

router.get('/coverage', protect, authorize(...NURSE_ROLES), ctrl.getCoverage);

module.exports = router;

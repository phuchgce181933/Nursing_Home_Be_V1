const express = require('express');
const router = express.Router();
const { login, getMe, createStaffAccount, listStaffAccounts, toggleStaffActive } = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');

// Public
router.post('/login', login);

// Any authenticated user
router.get('/me', protect, getMe);

// Admin / Manager only
router.post('/create-staff', protect, authorize('admin', 'manager'), createStaffAccount);
router.get('/staff', protect, authorize('admin', 'manager'), listStaffAccounts);
router.put('/staff/:id/toggle-active', protect, authorize('admin', 'manager'), toggleStaffActive);

module.exports = router;

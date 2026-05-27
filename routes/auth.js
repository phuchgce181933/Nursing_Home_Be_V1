const express = require('express');
const router = express.Router();
const {
  login,
  getMe,
  createStaffAccount,
  listStaffAccounts,
  toggleStaffActive,
  createFirebaseToken,
} = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');
const { uploadAvatar } = require('../middleware/uploadMiddleware');

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: User login
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: Email and password required
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', login);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved
 *       401:
 *         description: Unauthorized
 */
router.get('/me', protect, getMe);

/**
 * @swagger
 * /api/auth/firebase-token:
 *   post:
 *     summary: Mint Firebase custom token for Realtime Database (emergency readiness)
 *     description: |
 *       After JWT login, call this endpoint then use `signInWithCustomToken` on the frontend.
 *       Custom claims include `role` for RTDB security rules.
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Firebase custom token and database URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 firebaseToken:
 *                   type: string
 *                 databaseURL:
 *                   type: string
 *       503:
 *         description: Firebase not configured on server
 */
router.post('/firebase-token', protect, authorize('admin', 'manager'), createFirebaseToken);

/**
 * @swagger
 * /api/auth/create-staff:
 *   post:
 *     summary: Create staff account (admin or manager)
 *     description: |
 *       Admin may create any staff role including admin and manager.
 *       Manager may only create doctor, nurse, and staff accounts.
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [fullName, email, password, role]
 *             properties:
 *               fullName:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               username:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [doctor, nurse, staff, manager, admin]
 *                 description: Manager callers may only use doctor, nurse, staff
 *               phone:
 *                 type: string
 *               specialty:
 *                 type: string
 *               certifications:
 *                 type: array
 *                 items:
 *                   type: string
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Staff account created
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email already in use
 */
router.post('/create-staff', protect, authorize('admin', 'manager'), uploadAvatar, createStaffAccount);

/**
 * @swagger
 * /api/auth/staff:
 *   get:
 *     summary: List all staff accounts (Admin/Manager only)
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: Staff list retrieved
 */
router.get('/staff', protect, authorize('admin', 'manager'), listStaffAccounts);

/**
 * @swagger
 * /api/auth/staff/{id}/toggle-active:
 *   put:
 *     summary: Toggle staff account active status
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Account status toggled
 *       404:
 *         description: User not found
 */
router.put('/staff/:id/toggle-active', protect, authorize('admin', 'manager'), toggleStaffActive);

module.exports = router;

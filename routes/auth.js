const express = require('express');
const router = express.Router();
const { login, getMe, createStaffAccount, listStaffAccounts, toggleStaffActive } = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');

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
 * /api/auth/create-staff:
 *   post:
 *     summary: Create staff account (Admin/Manager only)
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
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
 *               role:
 *                 type: string
 *                 enum: [doctor, nurse, manager, staff, admin]
 *               phone:
 *                 type: string
 *               specialty:
 *                 type: string
 *               certifications:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Staff account created
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email already in use
 */
router.post('/create-staff', protect, authorize('admin', 'manager'), createStaffAccount);

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

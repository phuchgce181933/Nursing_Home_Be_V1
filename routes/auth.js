const express = require('express');
const router = express.Router();
const {
  login,
  getMe,
  createStaffAccount,
  searchFamilyAccounts,
  listStaffAccounts,
  toggleStaffActive,
  createFirebaseToken,
  updateProfile,
  requestEmailChangeOtp,
  requestPhoneChangeOtp,
  verifyEmailChangeOtp,
  verifyPhoneChangeOtp,
  changePassword,
  forgotPassword,
  resetPassword,
  updateUserByAdmin
} = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');
const { uploadAvatar, uploadAvatarAndCertifications } = require('../middleware/uploadMiddleware');
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 login/forgot-password attempts per windowMs
  message: { message: 'Quá nhiều lần thử từ địa chỉ IP này, vui lòng thử lại sau' },
});

// Rate limit riêng cho /reset-password: token là 64 hex ký tự nên về lý thuyết brute-force
// rất khó, nhưng vẫn cần giới hạn để giảm thiểu việc dò token đã rò rỉ qua log, history, v.v.
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Quá nhiều lần thử từ địa chỉ IP này, vui lòng thử lại sau' },
});

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
 *                 example: "doctor@test.com"
 *               password:
 *                 type: string
 *                 example: "password123"
 *     responses:
 *       200:
 *         description: Login successful, returns JWT token
 *       400:
 *         description: Email and password required
 *       401:
 *         description: Invalid credentials or account inactive/banned
 */
router.post('/login', loginLimiter, login);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user profile (includes staffProfile if applicable)
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
router.post('/firebase-token', protect, authorize('admin'), createFirebaseToken);

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
 *             required: [fullName, email, password, role, dateOfBirth]
 *             properties:
 *               fullName:
 *                 type: string
 *                 example: "Nguyễn Văn A"
 *               email:
 *                 type: string
 *                 example: "staff@hospital.com"
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 example: "password123"
 *               role:
 *                 type: string
 *                 enum: [doctor, nurse, manager, staff, pharmacist, caregiver, family, admin]
 *                 description: Manager callers may only use doctor, nurse, staff. Admin may also create family accounts.
 *               phone:
 *                 type: string
 *                 example: "0901234567"
 *               gender:
 *                 type: string
 *                 enum: [male, female, other, unknown]
 *                 example: "female"
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *                 example: "1990-05-15"
 *               address:
 *                 type: string
 *                 example: "123 Nguyễn Huệ, Q1, TP.HCM"
 *               specialty:
 *                 type: string
 *                 example: "Chăm sóc người cao tuổi"
 *               staffCode:
 *                 type: string
 *                 description: Custom staff code (auto-generated if omitted)
 *                 example: "NUR099"
 *               certifications:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["RN License", "CPR Certified"]
 *               certificationFiles:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: DOC/DOCX/PDF certification files
 *               avatar:
 *                 type: string
 *                 format: binary
 *               residentName:
 *                 type: string
 *                 description: Optional. Only used when role is 'family' — the resident name shown in the welcome email.
 *                 example: "Nguyễn Văn B"
 *     responses:
 *       201:
 *         description: Staff account created
 *       400:
 *         description: Validation error or password too short
 *       409:
 *         description: Email or staffCode already in use
 */
router.post('/create-staff', protect, authorize('admin'), uploadAvatarAndCertifications, createStaffAccount);

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
 *           enum: [doctor, nurse, manager, staff, admin]
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by fullName or email
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Staff list retrieved
 */
router.get('/staff', protect, authorize('admin'), listStaffAccounts);

/**
 * @swagger
 * /api/auth/family-accounts:
 *   get:
 *     summary: Search family accounts by name/email/phone (Admin/Manager only)
 *     description: Lightweight lookup used to link a family account to a resident without staff needing the account's raw Mongo ID.
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Matching family accounts
 */
router.get('/family-accounts', protect, authorize('admin'), searchFamilyAccounts);

/**
 * @swagger
 * /api/auth/staff/{id}/toggle-active:
 *   put:
 *     summary: Toggle staff account active/inactive (Admin/Manager only)
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ObjectId
 *     responses:
 *       200:
 *         description: Account status toggled
 *       400:
 *         description: Cannot toggle your own account
 *       404:
 *         description: User not found
 */
router.put('/staff/:id/toggle-active', protect, authorize('admin'), toggleStaffActive);

// Phuc/update profile
/**
 * @swagger
 * /api/auth/profile:
 *   put:
 *     summary: Update current user profile
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName:
 *                 type: string
 *               phone:
 *                 type: string
 *               gender:
 *                 type: string
 *                 enum: [male, female, other, unknown]
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         description: Unauthorized
 */
router.put('/profile', protect, uploadAvatar, updateProfile);
router.post('/profile/email-otp', protect, requestEmailChangeOtp);
router.post('/profile/phone-otp', protect, requestPhoneChangeOtp);
router.post('/profile/email-verify', protect, verifyEmailChangeOtp);
router.post('/profile/phone-verify', protect, verifyPhoneChangeOtp);

// Phuc/change password 
/**
 * @swagger
 * /api/auth/change-password:
 *   put:
 *     summary: Change current user password
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Current password incorrect
 */
router.put('/change-password', protect, changePassword);
// qiuên mk
/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Send reset password email (Web link or Mobile code, chosen by `client`)
 *     description: >
 *       `client` quyết định loại email được gửi. `web` -> email có liên kết đặt lại;
 *       `mobile` -> email chỉ có mã 6 số để copy, không chứa liên kết Web.
 *       Bỏ trống thì mặc định `web` (tương thích ngược). Luôn trả về cùng một
 *       phản hồi dù email có tồn tại hay không, để chống liệt kê tài khoản.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *               client:
 *                 type: string
 *                 enum: [web, mobile]
 *                 default: web
 *     responses:
 *       200:
 *         description: Generic response — reset instructions sent if the account exists
 *       400:
 *         description: Invalid email format or invalid `client` value
 */
router.post('/forgot-password', loginLimiter, forgotPassword);
// reset mk — áp dụng resetLimiter (10 req / 15 min) để giảm brute-force:
// token Web 64 hex thì khó dò, nhưng mã Mobile chỉ 6 số nên giới hạn theo IP ở đây
// là lớp phòng vệ thứ hai, bên cạnh trần 5 lần nhập sai cho mỗi mã (otpService).
/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password using a Web token or a Mobile reset code
 *     description: >
 *       Hai đường xác thực, một luồng nghiệp vụ. Web gửi `{ token, newPassword }`;
 *       ứng dụng di động gửi `{ email, code, newPassword }`. Bắt buộc phải có một
 *       trong hai loại credential — email kèm mật khẩu mới là KHÔNG đủ.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *                 description: Credential của Web, lấy từ liên kết trong email
 *               email:
 *                 type: string
 *                 description: Bắt buộc khi dùng mã của ứng dụng di động
 *               code:
 *                 type: string
 *                 description: Mã 6 số trong email gửi cho ứng dụng di động
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Missing credential, weak password, or invalid/expired token/code
 */
router.post('/reset-password', resetLimiter, resetPassword);

// update user by admin
/**
 * @swagger
 * /api/auth/users/{id}:
 *   put:
 *     summary: Admin update any user account
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName:
 *                 type: string
 *               phone:
 *                 type: string
 *               gender:
 *                 type: string
 *                 enum: [male, female, other, unknown]
 *               address:
 *                 type: string
 *               role:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *               isBanned:
 *                 type: boolean
 *               banReason:
 *                 type: string
 *     responses:
 *       200:
 *         description: User updated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 */
router.put(
  '/users/:id',
  protect,
  authorize('admin'),
  updateUserByAdmin
);
module.exports = router;

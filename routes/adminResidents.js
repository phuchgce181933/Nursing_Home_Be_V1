const express = require('express');
const router = express.Router();
const {
  adminCreateResident,
  adminListResidents,
  adminGetResident,
  adminUpdatePersonalInfo,
  adminUpdateFamilyInfo,
} = require('../controllers/residentController');
const { protect, authorize } = require('../middleware/auth');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

const adminOnly = authorize('admin');
const adminManager = authorize('admin', 'nurse', 'doctor');

router.use(protect);

/**
 * @swagger
 * /api/admin/residents:
 *   post:
 *     summary: Create resident profile (Admin)
 *     tags: [Admin - Resident Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullName
 *             properties:
 *               residentCode:
 *                 type: string
 *               fullName:
 *                 type: string
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *               gender:
 *                 type: string
 *                 enum: [male, female, other, unknown]
 *               citizenId:
 *                 type: string
 *               insuranceNumber:
 *                 type: string
 *               bloodType:
 *                 type: string
 *                 enum: [A+, A-, B+, B-, AB+, AB-, O+, O-, unknown]
 *               personalAddress:
 *                 type: string
 *               allergies:
 *                 type: array
 *                 items:
 *                   type: string
 *               chronicConditions:
 *                 type: array
 *                 items:
 *                   type: string
 *               initialHealthCondition:
 *                 type: string
 *               residencyStatus:
 *                 type: string
 *                 enum: [pending, admitted, discharged, transferred, inactive]
 *               admittedAt:
 *                 type: string
 *                 format: date-time
 *               dischargedAt:
 *                 type: string
 *                 format: date-time
 *               servicePackage:
 *                 type: string
 *               emergencyContacts:
 *                 type: array
 *                 items:
 *                   type: object
 *               familyPortalAccountIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Resident profile created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 */
router.post('/', adminOnly, adminCreateResident);

/**
 * @swagger
 * /api/admin/residents:
 *   get:
 *     summary: List/search resident profiles (Admin)
 *     tags: [Admin - Resident Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by residentCode, fullName, citizenId, or insuranceNumber
 *       - in: query
 *         name: residencyStatus
 *         schema:
 *           type: string
 *           enum: [pending, admitted, discharged, transferred, inactive]
 *       - in: query
 *         name: gender
 *         schema:
 *           type: string
 *           enum: [male, female, other, unknown]
 *       - in: query
 *         name: bloodType
 *         schema:
 *           type: string
 *           enum: [A+, A-, B+, B-, AB+, AB-, O+, O-, unknown]
 *       - in: query
 *         name: admittedFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: admittedTo
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: roomId
 *         schema:
 *           type: string
 *       - in: query
 *         name: bedId
 *         schema:
 *           type: string
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
 *         description: Paginated list of residents
 */
router.get('/', adminManager, adminListResidents);

/**
 * @swagger
 * /api/admin/residents/{residentId}:
 *   get:
 *     summary: Get resident profile (Admin)
 *     tags: [Admin - Resident Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resident profile detail
 *       404:
 *         description: Resident not found
 */
router.get('/:residentId', adminManager, adminGetResident);

/**
 * @swagger
 * /api/admin/residents/{residentId}/personal-info:
 *   patch:
 *     summary: Update resident personal information (Admin)
 *     tags: [Admin - Resident Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
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
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *               gender:
 *                 type: string
 *                 enum: [male, female, other, unknown]
 *               citizenId:
 *                 type: string
 *               insuranceNumber:
 *                 type: string
 *               bloodType:
 *                 type: string
 *                 enum: [A+, A-, B+, B-, AB+, AB-, O+, O-, unknown]
 *               personalAddress:
 *                 type: string
 *               allergies:
 *                 type: array
 *                 items:
 *                   type: string
 *               chronicConditions:
 *                 type: array
 *                 items:
 *                   type: string
 *               initialHealthCondition:
 *                 type: string
 *     responses:
 *       200:
 *         description: Resident personal info updated
 */
router.patch('/:residentId/personal-info', adminOnly, adminUpdatePersonalInfo);

/** Upload avatar image (multipart/form-data: field `avatar`) */
router.post('/:residentId/avatar', adminOnly, upload.single('avatar'), async (req, res, next) => {
  // delegate to controller method
  try {
    await require('../controllers/residentController').adminUploadAvatar(req, res);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/admin/residents/{residentId}/family-info:
 *   patch:
 *     summary: Update resident family information (Admin)
 *     tags: [Admin - Resident Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
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
 *               emergencyContacts:
 *                 type: array
 *                 items:
 *                   type: object
 *               familyPortalAccountIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Resident family info updated
 */
router.patch('/:residentId/family-info', adminOnly, adminUpdateFamilyInfo);

module.exports = router;

const express = require('express');
const router = express.Router();
const {
  listStaffProfiles,
  getStaffProfile,
  updateStaffProfile,
  updateStaffRole,
  banStaff,
  unbanStaff,
  assignAreas,
  assignResidents,
  listResidentsAvailableForStaff,
  listAssignedResidents,
  getAvailability,
  getAreaCoverageStatus,
} = require('../controllers/staffController');
const { protect, authorize } = require('../middleware/auth');
const { uploadAvatarAndCertifications } = require('../middleware/uploadMiddleware');

/**
 * @swagger
 * /api/staff/availability:
 *   get:
 *     summary: Emergency readiness — doctor/nurse availability by date (STT 10)
 *     description: |
 *       Scoped to the `date` query (YYYY-MM-DD, default today). Shifts use published or
 *       confirmed status (same as care-task assignment). When date is today, on-shift uses
 *       the real-time local clock and the shift startTime–endTime window.
 *       `hasTasks` is true only when the staff member has both an eligible shift and an
 *       active care task (pending/in_progress) on that same date.
 *       Readiness levels map to the emergency UI (Sẵn sàng / Đang chăm sóc / Không trực / Nghỉ phép).
 *     tags: [Staff]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [doctor, nurse]
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           pattern: '^\\d{4}-\\d{2}-\\d{2}$'
 *           example: '2026-05-24'
 *         description: YYYY-MM-DD (defaults to today in local timezone)
 *       - in: query
 *         name: floorId
 *         schema:
 *           type: string
 *         description: Filter to staff assigned to this floor
 *     responses:
 *       200:
 *         description: |
 *           Staff readiness list. Root includes summary counts and checkedAt (ISO) when date is today.
 *           Each item has readinessLevel (ready|caring|off_duty|on_leave), readinessLabelVi,
 *           isOnShift, onShift, hasTasks (date-scoped; requires shift + active task on that date),
 *           currentShift (published/confirmed shift for the date, active window when today),
 *           legacy availabilityStatus, and contact fields for emergency call UI:
 *           phone (User), staffCode, specialty, certifications[] (StaffProfile; top-level for convenience).
 *           Nested staffProfile is retained for backward compatibility.
 *       400:
 *         description: Invalid date format (must be YYYY-MM-DD) or invalid role
 */
router.get('/availability', protect, authorize('admin'), getAvailability);

/**
 * @swagger
 * /api/staff/floors/{floorId}/coverage:
 *   get:
 *     summary: Get area coverage status for a floor (STT 8)
 *     tags: [Staff]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: floorId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: "Coverage status: fullyStaffed / understaffed / noCoverage"
 */
router.get('/floors/:floorId/coverage', protect, authorize('admin'), getAreaCoverageStatus);

/**
 * @swagger
 * /api/staff:
 *   get:
 *     summary: List all staff profiles (STT 1). Use assignmentDate for shift info on assignment screen.
 *     tags: [Staff]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: assignmentDate
 *         schema:
 *           type: string
 *           pattern: '^\\d{4}-\\d{2}-\\d{2}$'
 *           example: '2026-05-26'
 *         description: When set, each staff item includes shiftSummary (published/confirmed shifts, times). Empty defaults to today. Alias query param date.
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           pattern: '^\\d{4}-\\d{2}-\\d{2}$'
 *         description: Alias for assignmentDate
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [admin, manager, doctor, nurse, staff]
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: isBanned
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by fullName, email, or username
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
 *         description: |
 *           Paginated list of staff. Each item includes assignable { shift, careTask, areas, residents } (false for admin/manager).
 *           With assignmentDate, root includes assignmentDate and each item has shiftSummary.
 *       400:
 *         description: Invalid assignmentDate format
 */
router.get('/', protect, authorize('admin'), listStaffProfiles);

/**
 * @swagger
 * /api/staff/{id}:
 *   get:
 *     summary: Get full staff profile detail (STT 1)
 *     tags: [Staff]
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
 *         description: Full staff info (no password/security fields)
 *       404:
 *         description: Not found
 */
router.get('/:id', protect, authorize('admin'), getStaffProfile);

/**
 * @swagger
 * /api/staff/{id}:
 *   put:
 *     summary: Update basic staff profile info (STT 1). Upload avatar or certification images as multipart/form-data.
 *     tags: [Staff]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
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
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *                 description: Required. Staff must be at least 18 years old.
 *               address:
 *                 type: string
 *               specialty:
 *                 type: string
 *               certifications:
 *                 type: array
 *                 items:
 *                   type: string
 *               certificationFiles:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               removedCertPublicIds:
 *                 type: string
 *                 description: JSON array of Cloudinary publicId values for certification images to remove
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Profile updated (security fields not editable here)
 */
router.put('/:id', protect, authorize('admin'), uploadAvatarAndCertifications, updateStaffProfile);

/**
 * @swagger
 * /api/staff/{id}/role:
 *   put:
 *     summary: Classify / update staff role (STT 2)
 *     tags: [Staff]
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
 *               role:
 *                 type: string
 *                 enum: [doctor, nurse, manager, staff, admin]
 *                 description: System role; StaffProfile.roleCategory is set to the same value automatically.
 *     responses:
 *       200:
 *         description: Role updated
 */
router.put('/:id/role', protect, authorize('admin'), updateStaffRole);

/**
 * @swagger
 * /api/staff/{id}/ban:
 *   put:
 *     summary: Ban a staff account (STT 1)
 *     tags: [Staff]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               banReason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Staff account banned
 *       400:
 *         description: Already banned or self-ban attempt
 */
router.put('/:id/ban', protect, authorize('admin'), banStaff);

/**
 * @swagger
 * /api/staff/{id}/unban:
 *   put:
 *     summary: Unban a staff account (STT 1)
 *     tags: [Staff]
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
 *         description: Staff account unbanned
 */
router.put('/:id/unban', protect, authorize('admin'), unbanStaff);

/**
 * @swagger
 * /api/staff/{id}/areas:
 *   put:
 *     summary: Assign staff to responsible floors and rooms (STT 8). Not allowed for admin/manager. Use GET /api/facilities/floors for dropdowns.
 *     description: |
 *       When floors or rooms are removed or narrowed, residents outside the new area are automatically
 *       removed from assignedResidentIds (unless active care tasks block the change — 409 with blockingTasks).
 *       Response includes residentsPruned when prune succeeds.
 *     tags: [Staff]
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
 *               floorIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               roomIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Areas assigned; residentsPruned lists residents auto-unassigned when area shrinks
 *       400:
 *         description: Invalid floor/room or staff on leave
 *       409:
 *         description: Active care tasks block area change; response includes blockingTasks array
 */
router.put('/:id/areas', protect, authorize('admin'), assignAreas);

/**
 * @swagger
 * /api/staff/{id}/residents/available:
 *   get:
 *     summary: List residents available for assignment to this staff member
 *     description: |
 *       If staff has responsibleRoomIds (e.g. only room 101), returns residents in those rooms only — not every room on the floor.
 *       If only responsibleAreaIds (floors) with no rooms, returns all residents on those floors.
 *     tags: [Staff]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User _id of staff member
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           default: admitted
 *     responses:
 *       200:
 *         description: Residents filtered by staff assigned rooms or floors (filterMode rooms|floors|none)
 */
router.get(
  '/:id/residents/available',
  protect,
  authorize('admin'),
  listResidentsAvailableForStaff
);

/**
 * @swagger
 * /api/staff/{id}/residents/assigned:
 *   get:
 *     summary: List residents already assigned to staff (for care task dropdown)
 *     description: Returns assignedResidentIds from staff profile — use after Residents tab assignment.
 *     tags: [Staff]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User _id of staff member
 *     responses:
 *       200:
 *         description: Populated assigned residents (may be empty with guidance message)
 */
router.get(
  '/:id/residents/assigned',
  protect,
  authorize('admin'),
  listAssignedResidents
);

/**
 * @swagger
 * /api/staff/{id}/residents:
 *   put:
 *     summary: Assign elderly care duties to staff (STT 9). Not allowed for admin/manager.
 *     tags: [Staff]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User _id of staff member
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               residentIds:
 *                 oneOf:
 *                   - type: array
 *                     items:
 *                       type: string
 *                   - type: string
 *                 description: Array of resident ObjectIds or comma-separated string. Empty clears all assignments.
 *     responses:
 *       200:
 *         description: Residents assigned; staffProfile includes populated assignedResidentIds
 *       400:
 *         description: Invalid IDs, area mismatch, or admin/manager cannot be assigned
 *       409:
 *         description: Active care tasks block resident removal; response includes blockingTasks array
 */
router.put('/:id/residents', protect, authorize('admin'), assignResidents);

module.exports = router;

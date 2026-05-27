const express = require('express');
const router = express.Router();
const {
  createAppointment,
  listAppointments,
  getMyAppointments,
  getDailySchedule,
  getWeeklySchedule,
  getAppointment,
  updateAppointment,
  deleteAppointment,
  updateStatus,
  assignDoctor,
  assignNurse,
  sendReminder,
} = require('../controllers/careAppointmentController');
const { protect, authorize } = require('../middleware/auth');

const STAFF_ROLES = ['admin', 'manager', 'doctor', 'nurse'];

/**
 * @swagger
 * /api/care-appointments:
 *   post:
 *     summary: Create a new care appointment
 *     tags: [Care Appointments]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [residentId, scheduledStartAt, scheduledEndAt]
 *             properties:
 *               residentId:
 *                 type: string
 *                 example: "64f1a2b3c4d5e6f7a8b9c0d1"
 *               scheduledStartAt:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-06-01T08:00:00.000Z"
 *               scheduledEndAt:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-06-01T09:00:00.000Z"
 *               appointmentType:
 *                 type: string
 *                 example: "Khám tổng quát"
 *               doctorStaffId:
 *                 type: string
 *                 example: "64f1a2b3c4d5e6f7a8b9c0d2"
 *               nurseStaffId:
 *                 type: string
 *                 example: "64f1a2b3c4d5e6f7a8b9c0d3"
 *               notes:
 *                 type: string
 *                 example: "Kiểm tra huyết áp và đường huyết"
 *     responses:
 *       201:
 *         description: Appointment created
 *       400:
 *         description: Validation error or resident not admitted
 *       404:
 *         description: Resident or staff not found
 *       409:
 *         description: Schedule conflict
 */
router.post('/', protect, authorize(...STAFF_ROLES), createAppointment);

/**
 * @swagger
 * /api/care-appointments:
 *   get:
 *     summary: List all care appointments (with filters)
 *     tags: [Care Appointments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
 *         description: Filter by resident ObjectId
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [scheduled, in_progress, completed, cancelled]
 *       - in: query
 *         name: appointmentType
 *         schema:
 *           type: string
 *       - in: query
 *         name: doctorStaffId
 *         schema:
 *           type: string
 *       - in: query
 *         name: nurseStaffId
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledStartAt >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter scheduledStartAt <= to
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
 *         description: List of appointments
 */
router.get('/', protect, authorize(...STAFF_ROLES), listAppointments);

/**
 * @swagger
 * /api/care-appointments/my:
 *   get:
 *     summary: Get my own appointments (doctor or nurse only)
 *     description: Returns appointments where the logged-in doctor or nurse is assigned. Sorted by scheduledStartAt ascending.
 *     tags: [Care Appointments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [scheduled, in_progress, completed, cancelled]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: My appointment list
 *       404:
 *         description: Staff profile not found
 */
router.get('/my', protect, authorize('doctor', 'nurse'), getMyAppointments);

/**
 * @swagger
 * /api/care-appointments/daily:
 *   get:
 *     summary: Get daily schedule
 *     tags: [Care Appointments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         description: Date to view (ISO 8601). Defaults to today.
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
 *           format: date
 *         description: Date to view (default today), e.g. 2025-06-01
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
 *         description: Filter by resident ObjectId
 *     responses:
 *       200:
 *         description: Daily schedule
 */
router.get('/daily', protect, authorize(...STAFF_ROLES), getDailySchedule);

/**
 * @swagger
 * /api/care-appointments/weekly:
 *   get:
 *     summary: Get weekly schedule (Mon–Sun of the given date)
 *     tags: [Care Appointments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         description: Any date within the desired week (ISO 8601). Defaults to current week.
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
 *           format: date
 *         description: Any date within the target week (default current week), e.g. 2025-06-01
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
 *         description: Filter by resident ObjectId
 *     responses:
 *       200:
 *         description: Weekly schedule
 */
router.get('/weekly', protect, authorize(...STAFF_ROLES), getWeeklySchedule);

/**
 * @swagger
 * /api/care-appointments/{id}:
 *   get:
 *     summary: Get appointment by ID
 *     tags: [Care Appointments]
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
 *         description: Appointment details
 *       404:
 *         description: Appointment not found
 */
router.get('/:id', protect, authorize(...STAFF_ROLES), getAppointment);

/**
 * @swagger
 * /api/care-appointments/{id}:
 *   put:
 *     summary: Update appointment time/type/notes (not allowed on completed or cancelled)
 *     tags: [Care Appointments]
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
 *               scheduledStartAt:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-06-01T08:00:00.000Z"
 *               scheduledEndAt:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-06-01T09:30:00.000Z"
 *               appointmentType:
 *                 type: string
 *                 example: "Khám tổng quát"
 *               notes:
 *                 type: string
 *                 example: "Cập nhật ghi chú"
 *     responses:
 *       200:
 *         description: Appointment updated
 *       400:
 *         description: Cannot edit completed/cancelled appointment or schedule conflict
 *       404:
 *         description: Appointment not found
 *       409:
 *         description: Schedule conflict
 */
router.put('/:id', protect, authorize(...STAFF_ROLES), updateAppointment);

/**
 * @swagger
 * /api/care-appointments/{id}:
 *   delete:
 *     summary: Delete appointment (not allowed while in_progress)
 *     tags: [Care Appointments]
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
 *         description: Appointment deleted
 *       400:
 *         description: Cannot delete in-progress appointment
 *       404:
 *         description: Appointment not found
 */
router.delete('/:id', protect, authorize('admin', 'manager', 'doctor'), deleteAppointment);

/**
 * @swagger
 * /api/care-appointments/{id}/status:
 *   put:
 *     summary: Update appointment status (enforces valid transitions)
 *     description: |
 *       Allowed transitions:
 *       - scheduled → in_progress | cancelled
 *       - in_progress → completed | cancelled
 *       - completed → (terminal)
 *       - cancelled → (terminal)
 *     tags: [Care Appointments]
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
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [scheduled, in_progress, completed, cancelled]
 *                 example: "in_progress"
 *     responses:
 *       200:
 *         description: Status updated
 *       400:
 *         description: Invalid status transition
 *       404:
 *         description: Appointment not found
 */
router.put('/:id/status', protect, authorize(...STAFF_ROLES), updateStatus);

/**
 * @swagger
 * /api/care-appointments/{id}/assign-doctor:
 *   put:
 *     summary: Assign doctor to appointment (staff must have roleCategory = doctor)
 *     tags: [Care Appointments]
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
 *               doctorStaffId:
 *                 type: string
 *                 description: StaffProfile _id. Leave empty to unassign.
 *                 example: "64f1a2b3c4d5e6f7a8b9c0d2"
 *     responses:
 *       200:
 *         description: Doctor assigned
 *       400:
 *         description: Staff is not a doctor, or appointment is completed/cancelled
 *       404:
 *         description: Appointment or staff profile not found
 */
router.put('/:id/assign-doctor', protect, authorize('admin', 'manager'), assignDoctor);

/**
 * @swagger
 * /api/care-appointments/{id}/assign-nurse:
 *   put:
 *     summary: Assign nurse to appointment (staff must have roleCategory = nurse)
 *     tags: [Care Appointments]
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
 *               nurseStaffId:
 *                 type: string
 *                 description: StaffProfile _id. Leave empty to unassign.
 *                 example: "64f1a2b3c4d5e6f7a8b9c0d3"
 *     responses:
 *       200:
 *         description: Nurse assigned
 *       400:
 *         description: Staff is not a nurse, or appointment is completed/cancelled
 *       404:
 *         description: Appointment or staff profile not found
 */
router.put('/:id/assign-nurse', protect, authorize('admin', 'manager'), assignNurse);

/**
 * @swagger
 * /api/care-appointments/{id}/reminder:
 *   post:
 *     summary: Send appointment reminder (only for scheduled appointments)
 *     description: Sends in-app notifications to assigned doctor, nurse, and family members.
 *     tags: [Care Appointments]
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
 *         description: Reminders sent
 *       400:
 *         description: Appointment is not in scheduled status
 *       404:
 *         description: Appointment not found
 */
router.post('/:id/reminder', protect, authorize(...STAFF_ROLES), sendReminder);

module.exports = router;

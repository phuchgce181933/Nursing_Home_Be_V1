const express = require('express');
const router = express.Router();
const {
  createAppointment,
  listAppointments,
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
const { attachStaffProfile } = require('../middleware/attachStaffProfile');

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
 *             required:
 *               - residentId
 *               - scheduledStartAt
 *               - scheduledEndAt
 *             properties:
 *               residentId:
 *                 type: string
 *                 description: ID của resident (bắt buộc)
 *               scheduledStartAt:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-05-26T08:00:00.000Z"
 *                 description: Thời gian bắt đầu (bắt buộc)
 *               scheduledEndAt:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-05-26T09:00:00.000Z"
 *                 description: Thời gian kết thúc, phải sau scheduledStartAt (bắt buộc)
 *               doctorStaffId:
 *                 type: string
 *                 description: ID của StaffProfile bác sĩ (tùy chọn)
 *               nurseStaffId:
 *                 type: string
 *                 description: ID của StaffProfile y tá (tùy chọn)
 *               appointmentType:
 *                 type: string
 *                 example: "Khám tổng quát"
 *                 description: Loại khám (tùy chọn)
 *               notes:
 *                 type: string
 *                 example: "Kiểm tra huyết áp định kỳ"
 *                 description: Ghi chú (tùy chọn)
 *     responses:
 *       201:
 *         description: Appointment created
 *       400:
 *         description: Thiếu field bắt buộc hoặc thời gian không hợp lệ
 *       409:
 *         description: Trùng lịch với appointment khác của resident
 */
router.post('/', protect, authorize(...STAFF_ROLES), createAppointment);

/**
 * @swagger
 * /api/care-appointments:
 *   get:
 *     summary: List all care appointments
 *     tags: [Care Appointments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
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
 *         description: List of appointments
 */
router.get('/', protect, authorize(...STAFF_ROLES), attachStaffProfile, listAppointments);

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
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Daily schedule
 */
router.get('/daily', protect, authorize(...STAFF_ROLES), attachStaffProfile, getDailySchedule);

/**
 * @swagger
 * /api/care-appointments/weekly:
 *   get:
 *     summary: Get weekly schedule
 *     tags: [Care Appointments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Weekly schedule
 */
router.get('/weekly', protect, authorize(...STAFF_ROLES), attachStaffProfile, getWeeklySchedule);

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
 */
router.get('/:id', protect, authorize(...STAFF_ROLES), attachStaffProfile, getAppointment);

/**
 * @swagger
 * /api/care-appointments/{id}:
 *   put:
 *     summary: Update appointment
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               scheduledStartAt:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-05-26T08:00:00.000Z"
 *                 description: Thời gian bắt đầu mới (tùy chọn)
 *               scheduledEndAt:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-05-26T09:00:00.000Z"
 *                 description: Thời gian kết thúc mới, phải sau scheduledStartAt (tùy chọn)
 *               doctorStaffId:
 *                 type: string
 *                 description: ID StaffProfile bác sĩ mới, truyền null để xóa (tùy chọn)
 *               nurseStaffId:
 *                 type: string
 *                 description: ID StaffProfile y tá mới, truyền null để xóa (tùy chọn)
 *               appointmentType:
 *                 type: string
 *                 example: "Khám tổng quát"
 *                 description: Loại khám (tùy chọn)
 *               notes:
 *                 type: string
 *                 example: "Kiểm tra huyết áp định kỳ"
 *                 description: Ghi chú (tùy chọn)
 *     responses:
 *       200:
 *         description: Appointment updated
 *       400:
 *         description: Thời gian không hợp lệ
 *       404:
 *         description: Appointment không tồn tại
 *       409:
 *         description: Trùng lịch với appointment khác của resident
 */
router.put('/:id', protect, authorize(...STAFF_ROLES), updateAppointment);

/**
 * @swagger
 * /api/care-appointments/{id}:
 *   delete:
 *     summary: Delete appointment
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
 */
router.delete('/:id', protect, authorize('admin', 'manager', 'doctor'), deleteAppointment);

/**
 * @swagger
 * /api/care-appointments/{id}/status:
 *   put:
 *     summary: Update appointment status
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
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status updated
 */
router.put('/:id/status', protect, authorize(...STAFF_ROLES), updateStatus);

/**
 * @swagger
 * /api/care-appointments/{id}/assign-doctor:
 *   put:
 *     summary: Assign doctor to appointment
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
 *               doctorId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Doctor assigned
 */
router.put('/:id/assign-doctor', protect, authorize(...STAFF_ROLES), assignDoctor);

/**
 * @swagger
 * /api/care-appointments/{id}/assign-nurse:
 *   put:
 *     summary: Assign nurse to appointment
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
 *               nurseId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Nurse assigned
 */
router.put('/:id/assign-nurse', protect, authorize(...STAFF_ROLES), assignNurse);

/**
 * @swagger
 * /api/care-appointments/{id}/reminder:
 *   post:
 *     summary: Send appointment reminder to assigned doctor, nurse and linked family accounts
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
 *         description: Reminders sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 recipientCount:
 *                   type: integer
 *                 recipients:
 *                   type: object
 *                   properties:
 *                     doctorNotified:
 *                       type: boolean
 *                     nurseNotified:
 *                       type: boolean
 *                     familyNotified:
 *                       type: integer
 *       400:
 *         description: Appointment is cancelled/completed, or has no recipients
 *       404:
 *         description: Appointment not found
 */
router.post('/:id/reminder', protect, authorize(...STAFF_ROLES), sendReminder);

module.exports = router;

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
 *             properties:
 *               residentId:
 *                 type: string
 *               type:
 *                 type: string
 *               startTime:
 *                 type: string
 *               endTime:
 *                 type: string
 *     responses:
 *       201:
 *         description: Appointment created
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
router.get('/', protect, authorize(...STAFF_ROLES), listAppointments);

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
router.get('/daily', protect, authorize(...STAFF_ROLES), getDailySchedule);

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
 */
router.get('/:id', protect, authorize(...STAFF_ROLES), getAppointment);

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
 *     responses:
 *       200:
 *         description: Appointment updated
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
 *     summary: Send appointment reminder
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
 *         description: Reminder sent
 */
router.post('/:id/reminder', protect, authorize(...STAFF_ROLES), sendReminder);

module.exports = router;

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

router.post('/', protect, authorize(...STAFF_ROLES), createAppointment);
router.get('/', protect, authorize(...STAFF_ROLES), listAppointments);
router.get('/daily', protect, authorize(...STAFF_ROLES), getDailySchedule);
router.get('/weekly', protect, authorize(...STAFF_ROLES), getWeeklySchedule);
router.get('/:id', protect, authorize(...STAFF_ROLES), getAppointment);
router.put('/:id', protect, authorize(...STAFF_ROLES), updateAppointment);
router.delete('/:id', protect, authorize('admin', 'manager', 'doctor'), deleteAppointment);
router.put('/:id/status', protect, authorize(...STAFF_ROLES), updateStatus);
router.put('/:id/assign-doctor', protect, authorize(...STAFF_ROLES), assignDoctor);
router.put('/:id/assign-nurse', protect, authorize(...STAFF_ROLES), assignNurse);
router.post('/:id/reminder', protect, authorize(...STAFF_ROLES), sendReminder);

module.exports = router;

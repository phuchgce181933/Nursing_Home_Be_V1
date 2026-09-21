const express = require('express');
const router = express.Router();
const {
  getAvailableMedications,
  getCurrentMedications,
  setMedicationSchedule,
  getDailySchedule,
  getSchedules,
  markTaken,
  markMissed,
  markRefused,
  markHeld,
  markNotAvailable,
  administerPRN,
  getHistory,
} = require('../controllers/scheduleController');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * /api/medications/available:
 *   get:
 *     summary: List active medications from pharmacy database (for doctor to select when prescribing)
 *     tags: [MedicationSchedules]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: "Search by name, medicationCode, or manufacturer"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: "List of active medications with _id, medicationCode, name, form, strength, unit"
 */
router.get('/available', protect, authorize('doctor', 'nurse', 'admin'), getAvailableMedications);

/**
 * @swagger
 * /api/medications/current:
 *   get:
 *     summary: Active medication items for a resident from ACTIVE prescriptions (Doctor or Nurse)
 *     tags: [MedicationSchedules]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of active medication items with prescription context
 *       400:
 *         description: residentId is required or invalid
 *       404:
 *         description: Resident not found
 */
router.get('/current', protect, authorize('doctor', 'nurse'), getCurrentMedications);

/**
 * @swagger
 * /api/medications/schedule/set:
 *   put:
 *     summary: Set startDate, endDate, and times for prescription items (Doctor only)
 *     tags: [MedicationSchedules]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [prescriptionId, items]
 *             properties:
 *               prescriptionId:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [prescriptionItemId]
 *                   properties:
 *                     prescriptionItemId:
 *                       type: string
 *                     startDate:
 *                       type: string
 *                       format: date
 *                     endDate:
 *                       type: string
 *                       format: date
 *                     times:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: "Must match item.frequency count (e.g. ['08:00','20:00'] for frequency=2)"
 *     responses:
 *       200:
 *         description: Items updated and schedules regenerated
 *       400:
 *         description: Validation error
 *       403:
 *         description: Prescription not ACTIVE
 *       404:
 *         description: Prescription or item not found
 */
router.put('/schedule/set', protect, authorize('doctor'), setMedicationSchedule);

/**
 * @swagger
 * /api/medications/schedule/daily:
 *   get:
 *     summary: Daily medication schedule grouped by resident (Doctor or Nurse)
 *     tags: [MedicationSchedules]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: "YYYY-MM-DD (defaults to today Vietnam time)"
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
 *         description: "Filter by one resident"
 *       - in: query
 *         name: wardId
 *         schema:
 *           type: string
 *         description: "Filter by floor/ward (floorId)"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, TAKEN, LATE_TAKEN, MISSED, SKIPPED, OVERDUE]
 *     responses:
 *       200:
 *         description: List grouped by resident with schedules[]
 */
router.get('/schedule/daily', protect, authorize('doctor', 'nurse'), getDailySchedule);

/**
 * @swagger
 * /api/medications/schedule:
 *   get:
 *     summary: Flat list of schedules for one resident (Doctor or Nurse)
 *     tags: [MedicationSchedules]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: "YYYY-MM-DD — if omitted, returns all dates"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, TAKEN, LATE_TAKEN, MISSED, SKIPPED, OVERDUE]
 *     responses:
 *       200:
 *         description: Flat schedule list
 *       400:
 *         description: residentId is required
 */
router.get('/schedule', protect, authorize('doctor', 'nurse'), getSchedules);

/**
 * @swagger
 * /api/medications/schedule/{id}/taken:
 *   patch:
 *     summary: Mark a schedule as taken (Nurse only)
 *     tags: [MedicationSchedules]
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
 *               actualTimeTaken:
 *                 type: string
 *                 format: date-time
 *                 description: "Defaults to now if omitted"
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: "Status set to TAKEN or LATE_TAKEN (if >2h after scheduled time)"
 *       400:
 *         description: Schedule not in PENDING or OVERDUE state
 *       404:
 *         description: Schedule not found
 */
router.patch('/schedule/:id/taken', protect, authorize('nurse'), markTaken);

/**
 * @swagger
 * /api/medications/schedule/{id}/missed:
 *   patch:
 *     summary: Mark a schedule as missed (Nurse only)
 *     tags: [MedicationSchedules]
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
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 enum: [refused, asleep, vomiting, hospitalized, other]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status set to MISSED
 *       400:
 *         description: Invalid reason or wrong state
 *       404:
 *         description: Schedule not found
 */
router.patch('/schedule/:id/missed', protect, authorize('nurse'), markMissed);
router.patch('/schedule/:id/refused', protect, authorize('nurse'), markRefused);
router.patch('/schedule/:id/held', protect, authorize('nurse'), markHeld);
router.patch('/schedule/:id/not-available', protect, authorize('nurse'), markNotAvailable);
router.post('/prn-administration', protect, authorize('nurse'), administerPRN);

/**
 * @swagger
 * /api/medications/history:
 *   get:
 *     summary: Medication administration history with compliance stats (Doctor or Nurse)
 *     tags: [MedicationSchedules]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: "YYYY-MM-DD start date (Vietnam time)"
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: "YYYY-MM-DD end date (Vietnam time)"
 *       - in: query
 *         name: medicationName
 *         schema:
 *           type: string
 *         description: "Case-insensitive substring filter"
 *     responses:
 *       200:
 *         description: |
 *           summary: { total, taken, lateTaken, missed, skipped, complianceRate }
 *           lowCompliance: true if complianceRate < 80
 *           weeklyCompliance: [{ week, rate }]
 *       400:
 *         description: residentId is required
 *       404:
 *         description: Resident not found
 */
router.get('/history', protect, authorize('doctor', 'nurse'), getHistory);

module.exports = router;

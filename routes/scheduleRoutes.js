const express = require('express');
const router = express.Router();
const {
  getDailySchedule,
  getSchedules,
  markTaken,
  markMissed,
  getHistory,
} = require('../controllers/scheduleController');
const { protect, authorize } = require('../middleware/auth');

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

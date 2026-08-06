const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/caregiverResidentController');
const { protect, authorize } = require('../middleware/auth');

const STAFF_ROLES = ['doctor', 'nurse'];

/**
 * @swagger
 * tags:
 *   name: StaffAssignedResidents
 *   description: Doctor/Nurse view of assigned residents (UC-213/214)
 */

/**
 * @swagger
 * /api/staff/assigned-residents:
 *   get:
 *     summary: List residents assigned to the logged-in doctor/nurse
 *     tags: [StaffAssignedResidents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Assigned admitted residents
 */
router.get('/', protect, authorize(...STAFF_ROLES), ctrl.listResidents);

/**
 * @swagger
 * /api/staff/assigned-residents/{id}:
 *   get:
 *     summary: Get one assigned resident detail (doctor/nurse)
 *     tags: [StaffAssignedResidents]
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
 *         description: Resident detail
 *       403:
 *         description: Not in assigned list
 */
router.get('/:id', protect, authorize(...STAFF_ROLES), ctrl.getResident);

module.exports = router;

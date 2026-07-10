const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/caregiverResidentController');
const { protect, authorize } = require('../middleware/auth');

const CAREGIVER_ROLES = ['caregiver'];

/**
 * @swagger
 * tags:
 *   name: CaregiverResidents
 *   description: Caregiver view of assigned residents (read-only)
 */

/**
 * @swagger
 * /api/caregiver/residents:
 *   get:
 *     summary: List residents assigned to the logged-in caregiver
 *     tags: [CaregiverResidents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Filter by fullName or residentCode
 *     responses:
 *       200:
 *         description: Assigned admitted residents
 */
router.get('/', protect, authorize(...CAREGIVER_ROLES), ctrl.listResidents);
router.get('/activities', protect, authorize(...CAREGIVER_ROLES), ctrl.listResidentActivities);

/**
 * @swagger
 * /api/caregiver/residents/{id}:
 *   get:
 *     summary: Get one assigned resident detail
 *     tags: [CaregiverResidents]
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
router.get('/:id', protect, authorize(...CAREGIVER_ROLES), ctrl.getResident);

module.exports = router;

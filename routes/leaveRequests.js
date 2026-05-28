const express = require('express');
const router = express.Router();
const {
  submitLeaveRequest,
  listLeaveRequests,
  getLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequest,
} = require('../controllers/leaveRequestController');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * /api/leave-requests:
 *   post:
 *     summary: Submit a leave request (STT 11)
 *     tags: [Leave Requests]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, startDate, endDate, reason]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [annual, sick, emergency, unpaid, other]
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 *               reason:
 *                 type: string
 *     responses:
 *       201:
 *         description: "Leave request submitted. daysRequested is inclusive of both startDate and endDate (e.g. 29/05–30/05 = 2 days). Response may include balanceWarning and/or shiftWarning."
 *       400:
 *         description: Validation error or less than 24h advance notice (non-emergency)
 *       409:
 *         description: Overlapping approved leave exists
 */
router.post('/', protect, authorize('admin', 'manager', 'doctor', 'nurse', 'staff'), submitLeaveRequest);

/**
 * @swagger
 * /api/leave-requests:
 *   get:
 *     summary: List leave requests (admin/manager sees all; staff sees own)
 *     tags: [Leave Requests]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: staffId
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
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
 *         description: List of leave requests
 */
router.get('/', protect, listLeaveRequests);

/**
 * @swagger
 * /api/leave-requests/{id}:
 *   get:
 *     summary: Get leave request detail
 *     tags: [Leave Requests]
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
 *         description: Leave request detail
 *       404:
 *         description: Not found
 */
router.get('/:id', protect, getLeaveRequest);

/**
 * @swagger
 * /api/leave-requests/{id}/approve:
 *   put:
 *     summary: Approve a leave request (STT 12) — auto-cancels shifts in leave period and deducts leave balance
 *     tags: [Leave Requests]
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
 *               reviewNote:
 *                 type: string
 *     responses:
 *       200:
 *         description: "Request approved. Response includes cancelledShifts if any shifts were auto-cancelled."
 */
router.put('/:id/approve', protect, authorize('admin', 'manager'), approveLeaveRequest);

/**
 * @swagger
 * /api/leave-requests/{id}/reject:
 *   put:
 *     summary: Reject a leave request (STT 12) — reviewNote is required
 *     tags: [Leave Requests]
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
 *             required: [reviewNote]
 *             properties:
 *               reviewNote:
 *                 type: string
 *                 description: Rejection reason (required)
 *     responses:
 *       200:
 *         description: Request rejected
 *       400:
 *         description: reviewNote is missing or request is not pending
 */
router.put('/:id/reject', protect, authorize('admin', 'manager'), rejectLeaveRequest);

/**
 * @swagger
 * /api/leave-requests/{id}:
 *   delete:
 *     summary: Cancel own pending leave request
 *     tags: [Leave Requests]
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
 *         description: Request cancelled
 */
router.delete('/:id', protect, authorize('admin', 'manager', 'doctor', 'nurse', 'staff'), cancelLeaveRequest);

module.exports = router;

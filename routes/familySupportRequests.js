const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  submitSupportRequest,
  closeSupportRequest,
  listSupportRequests,
  getSupportRequest,
  addMessage,
} = require('../controllers/supportRequestController');

router.use(protect);

/**
 * @swagger
 * /api/family/support-requests:
 *   post:
 *     summary: Send a support / consultation request (Family)
 *     tags: [Family Support]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullName
 *               - age
 *               - phone
 *               - address
 *             properties:
 *               fullName:
 *                 type: string
 *               age:
 *                 type: integer
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Support request created
 *       400:
 *         description: Validation error
 */
router.post('/', authorize('family'), submitSupportRequest);

/**
 * @swagger
 * /api/family/support-requests:
 *   get:
 *     summary: List family support requests (Family)
 *     tags: [Family Support]
 *     security:
 *       - BearerAuth: []
 *     
 *     responses:
 *       200:
 *         description: Paginated list
 */
// allow family to list their own requests and staff (manager/admin) to list all
router.get('/', authorize('family', 'admin'), listSupportRequests);

/**
 * @swagger
 * /api/family/support-requests/{requestId}:
 *   get:
 *     summary: Get support request detail (Family)
 *     tags: [Family Support]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Support request detail
 */
// allow family to view their own request and staff (manager/admin) to view any
router.get('/:requestId', authorize('family', 'admin'), getSupportRequest);

/**
 * @swagger
 * /api/family/support-requests/{requestId}/messages:
 *   post:
 *     summary: Send a message on a support request (Family on own request, or Staff on any)
 *     tags: [Family Support]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *     responses:
 *       201:
 *         description: Message added
 *       403:
 *         description: Not allowed on this request
 */
router.post('/:requestId/messages', authorize('family', 'admin'), addMessage);

/**
 * @swagger
 * /api/family/support-requests/{requestId}/close:
 *   patch:
 *     summary: Close or cancel a support request (Family or Staff)
 *     tags: [Family Support]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [close, cancel]
 *               closingNote:
 *                 type: string
 *     responses:
 *       200:
 *         description: Support request updated
 *       400:
 *         description: Invalid request
 */
// family may close/cancel their own requests; staff (manager/admin) may close any
router.patch('/:requestId/close', authorize('family', 'admin'), closeSupportRequest);

module.exports = router;

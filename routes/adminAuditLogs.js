const express = require('express');
const router = express.Router();
const auditLogController = require('../controllers/auditLogController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('admin'));

/**
 * @swagger
 * /api/admin/audit-logs:
 *   get:
 *     summary: List audit log entries (Admin)
 *     tags: [Admin - Audit Logs]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: actorUserId
 *         schema:
 *           type: string
 *         description: Filter by actor user id
 *       - in: query
 *         name: actorRole
 *         schema:
 *           type: string
 *         description: Filter by actor role
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Search by action name
 *       - in: query
 *         name: module
 *         schema:
 *           type: string
 *         description: Filter by module name or business module
 *       - in: query
 *         name: businessModule
 *         schema:
 *           type: string
 *         description: Filter by business module name
 *       - in: query
 *         name: targetEntityType
 *         schema:
 *           type: string
 *         description: Filter by target entity type
 *       - in: query
 *         name: targetEntityId
 *         schema:
 *           type: string
 *         description: Filter by target entity id
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter logs created on or after this date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter logs created on or before this date
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Fuzzy search across action, module, role, and entity type
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
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, action, module, actorRole]
 *           default: createdAt
 *       - in: query
 *         name: performedByRole
 *         schema:
 *           type: string
 *         description: Filter by the translated performer role value
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Paginated audit log list
 */
router.get('/filters', auditLogController.getAuditLogFilters);
router.get('/', auditLogController.listAuditLogs);

/**
 * @swagger
 * /api/admin/audit-logs/{logId}:
 *   get:
 *     summary: Get a single audit log entry by id (Admin)
 *     tags: [Admin - Audit Logs]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: logId
 *         required: true
 *         schema:
 *           type: string
 *         description: Audit log id
 *     responses:
 *       200:
 *         description: Audit log entry retrieved
 *       404:
 *         description: Audit log entry not found
 */
router.get('/:logId', auditLogController.getAuditLog);

module.exports = router;

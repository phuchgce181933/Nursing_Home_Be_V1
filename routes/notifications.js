const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const notifCtrl = require('../controllers/notificationController');
const pushTokenCtrl = require('../controllers/pushTokenController');

// Generic notification inbox for any authenticated role (staff/doctor/nurse/caregiver/manager/
// pharmacist/admin) — access control is per-user via recipientUserId scoping in the service
// layer, not a role allowlist here, so a new role never needs this file updated to see its own
// notifications. Family has its own scoped equivalent at /api/family/notifications.
router.use(protect);

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     summary: View Notification List
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: isRead
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: A paged list of notifications
 */
router.get('/', notifCtrl.listNotifications);

/**
 * GET /api/notifications/categories
 *  return available notification categories
 */
router.get('/categories', notifCtrl.getCategories);

/**
 * @swagger
 * /api/notifications/settings:
 *   get:
 *     summary: Get notification settings for current user
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Notification settings
 */
router.get('/settings', notifCtrl.getSettings);

/**
 * @swagger
 * /api/notifications/settings:
 *   post:
 *     summary: Configure Notification Settings
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabledCategories:
 *                 type: array
 *                 items:
 *                   type: string
 *               deliveryChannels:
 *                 type: array
 *                 items:
 *                   type: string
 *               doNotDisturb:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Updated settings
 */
router.post('/settings', notifCtrl.updateSettings);

/**
 * @swagger
 * /api/notifications/{id}/read:
 *   patch:
 *     summary: Mark Notifications as Read
 *     tags: [Notifications]
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
 *         description: Notification marked as read
 */
router.patch('/:id/read', notifCtrl.markRead);

/**
 * @swagger
 * /api/notifications/mark-read:
 *   post:
 *     summary: Mark multiple notifications as read
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Bulk mark success
 */
router.post('/mark-read', async (req, res, next) => {
  req.params.id = 'bulk';
  return notifCtrl.markRead(req, res, next);
});

/**
 * @swagger
 * /api/notifications/{id}:
 *   delete:
 *     summary: Delete Notifications
 *     tags: [Notifications]
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
 *         description: Deleted
 */
router.delete('/:id', notifCtrl.deleteNotification);

/**
 * @swagger
 * /api/notifications/delete:
 *   post:
 *     summary: Delete multiple notifications
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Bulk delete success
 */
router.post('/delete', async (req, res, next) => {
  req.params.id = 'bulk';
  return notifCtrl.deleteNotification(req, res, next);
});

// Expo push-token registration — any authenticated role, called once on app start/login
// and again on logout so this device stops receiving pushes for that account.
router.post('/push-token', pushTokenCtrl.registerPushToken);
router.delete('/push-token', pushTokenCtrl.unregisterPushToken);

module.exports = router;

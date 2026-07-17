const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const notifCtrl = require('../controllers/notificationController');

// Shared notifications route for staff and family
router.use(protect, authorize('admin', 'doctor', 'nurse', 'family'));

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

module.exports = router;

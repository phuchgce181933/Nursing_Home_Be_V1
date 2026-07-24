const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const notifCtrl = require('../controllers/notificationController');
const pushTokenCtrl = require('../controllers/pushTokenController');

// Generic notification inbox for any authenticated role (staff/doctor/nurse/manager/admin).
// Family has its own scoped equivalent at /api/family/notifications.
router.use(protect);

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     summary: View Notification List (any authenticated role)
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

router.get('/categories', notifCtrl.getCategories);

router.get('/settings', notifCtrl.getSettings);

router.post('/settings', notifCtrl.updateSettings);

/**
 * @swagger
 * /api/notifications/{id}/read:
 *   patch:
 *     summary: Mark Notification as Read
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

router.post('/mark-read', async (req, res, next) => {
  req.params.id = 'bulk';
  return notifCtrl.markRead(req, res, next);
});

router.delete('/:id', notifCtrl.deleteNotification);

router.post('/delete', async (req, res, next) => {
  req.params.id = 'bulk';
  return notifCtrl.deleteNotification(req, res, next);
});

// Expo push-token registration — any authenticated role, called once on app start/login
// and again on logout so this device stops receiving pushes for that account.
router.post('/push-token', pushTokenCtrl.registerPushToken);
router.delete('/push-token', pushTokenCtrl.unregisterPushToken);

module.exports = router;

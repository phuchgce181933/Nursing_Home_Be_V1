const notificationService = require('../services/notificationService');
const { NOTIFICATION_CATEGORIES, DELIVERY_CHANNELS } = require('../models/enums');

const listNotifications = async (req, res) => {
  try {
    const result = await notificationService.listForUser(req.user._id, req.query);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to list notifications' });
  }
};

const getCategories = async (req, res) => {
  try {
    return res.json({ categories: NOTIFICATION_CATEGORIES });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load categories' });
  }
};

const getSettings = async (req, res) => {
  try {
    const settings = await notificationService.getSettingsForUser(req.user);
    return res.json(settings);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to get notification settings' });
  }
};

const updateSettings = async (req, res) => {
  try {
    const { enabledCategories, deliveryChannels, doNotDisturb } = req.body;
    // sanitize
    const payload = {};
    if (enabledCategories) payload.enabledCategories = enabledCategories.filter((c) => NOTIFICATION_CATEGORIES.includes(c));
    if (deliveryChannels) payload.deliveryChannels = deliveryChannels.filter((c) => DELIVERY_CHANNELS.includes(c));
    if (typeof doNotDisturb !== 'undefined') payload.doNotDisturb = !!doNotDisturb;
    const settings = await notificationService.updateSettingsForUser(req.user._id, payload);
    return res.json(settings);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to update notification settings' });
  }
};

const markRead = async (req, res) => {
  try {
    const { id } = req.params;
    if (id === 'bulk') {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: 'ids required' });
      await notificationService.markManyAsRead(ids);
      return res.json({ success: true });
    }
    const notif = await notificationService.markAsRead(id);
    if (!notif) return res.status(404).json({ message: 'Notification not found' });
    return res.json(notif);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to mark notification as read' });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    if (id === 'bulk') {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: 'ids required' });
      await notificationService.deleteMany(ids);
      return res.json({ success: true });
    }
    const deleted = await notificationService.deleteById(id);
    if (!deleted) return res.status(404).json({ message: 'Notification not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to delete notification' });
  }
};

module.exports = {
  listNotifications,
  getCategories,
  getSettings,
  updateSettings,
  markRead,
  deleteNotification,
};

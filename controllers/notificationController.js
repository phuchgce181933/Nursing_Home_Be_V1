const notificationService = require('../services/notificationService');
const { NOTIFICATION_CATEGORIES, DELIVERY_CHANNELS } = require('../models/enums');

const listNotifications = async (req, res) => {
  try {
    const result = await notificationService.listForUser(req.user._id, req.query);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Không thể tải danh sách thông báo' });
  }
};

const getCategories = async (req, res) => {
  try {
    return res.json({ categories: NOTIFICATION_CATEGORIES });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Không thể tải danh mục' });
  }
};

const getSettings = async (req, res) => {
  try {
    const settings = await notificationService.getSettingsForUser(req.user);
    return res.json(settings);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Không thể lấy cài đặt thông báo' });
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
    return res.status(500).json({ message: 'Không thể cập nhật cài đặt thông báo' });
  }
};

const MAX_BULK_IDS = 500;

const markRead = async (req, res) => {
  try {
    const { id } = req.params;
    if (id === 'bulk') {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: 'ids là bắt buộc' });
      if (ids.length > MAX_BULK_IDS) return res.status(400).json({ message: `Chỉ có thể xử lý tối đa ${MAX_BULK_IDS} ids trong một lần` });
      await notificationService.markManyAsRead(ids, req.user._id);
      return res.json({ success: true });
    }
    const notif = await notificationService.markAsRead(id, req.user._id);
    if (!notif) return res.status(404).json({ message: 'Không tìm thấy thông báo' });
    return res.json(notif);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Không thể đánh dấu thông báo đã đọc' });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    if (id === 'bulk') {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: 'ids là bắt buộc' });
      if (ids.length > MAX_BULK_IDS) return res.status(400).json({ message: `Chỉ có thể xử lý tối đa ${MAX_BULK_IDS} ids trong một lần` });
      await notificationService.deleteMany(ids, req.user._id);
      return res.json({ success: true });
    }
    const deleted = await notificationService.deleteById(id, req.user._id);
    if (!deleted) return res.status(404).json({ message: 'Không tìm thấy thông báo' });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Không thể xóa thông báo' });
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

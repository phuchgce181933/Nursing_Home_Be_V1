const notificationRepo = require('../repositories/notificationRepository');
const User = require('../models/user');
const { escapeRegex } = require('../utils/validators');
const pushNotificationService = require('./pushNotificationService');

// Single entry point for creating in-app notifications: persists them, then best-effort
// pushes to each recipient's registered devices (respecting doNotDisturb/enabledCategories).
// All notification-creation call sites should go through this rather than the repository
// directly, so push delivery is never something an individual caller can forget to wire up.
const createMany = async (notifications) => {
  const created = await notificationRepo.insertMany(notifications);
  await Promise.all(
    created.map((n) =>
      pushNotificationService.sendPushToUsers([n.recipientUserId], {
        title: n.title,
        body: n.content,
        category: n.category,
        data: { notificationId: String(n._id), targetEntityType: n.targetEntityType, targetEntityId: n.targetEntityId ? String(n.targetEntityId) : undefined },
      })
    )
  );
  return created;
};

const buildListFilter = (userId, queryOptions = {}) => {
  const { category, isRead, search } = queryOptions;
  const filter = { recipientUserId: userId, isDeleted: false };
  if (category) filter.category = category;
  if (typeof isRead !== 'undefined') filter.isRead = isRead === 'true' || isRead === true;
  if (search) filter.$or = [
    { title: { $regex: search, $options: 'i' } },
    { content: { $regex: search, $options: 'i' } },
  ];
  return filter;
};

const buildSoftDeleteUpdate = () => ({
  $set: {
    isDeleted: true,
    deletedAt: new Date(),
  },
});

const listForUser = async (userId, queryOptions = {}) => {
  const { page = 1, limit = 20 } = queryOptions;
  const filter = buildListFilter(userId, queryOptions);
  return notificationRepo.findByRecipient(userId, filter, { page: parseInt(page, 10), limit: parseInt(limit, 10) });
};

const getSettingsForUser = async (user) => {
  return user.notificationSettings || {};
};

const updateSettingsForUser = async (userId, updates) => {
  const update = {};
  if (updates.enabledCategories) update['notificationSettings.enabledCategories'] = updates.enabledCategories;
  if (updates.deliveryChannels) update['notificationSettings.deliveryChannels'] = updates.deliveryChannels;
  if (typeof updates.doNotDisturb !== 'undefined') update['notificationSettings.doNotDisturb'] = !!updates.doNotDisturb;
  const user = await User.findByIdAndUpdate(userId, { $set: update }, { new: true }).select('notificationSettings');
  return user.notificationSettings;
};

const markAsRead = async (id, recipientUserId) => notificationRepo.markAsRead(id, recipientUserId);

const markManyAsRead = async (ids, recipientUserId) => notificationRepo.markManyAsRead(ids, recipientUserId);

const deleteById = async (id, recipientUserId) => notificationRepo.deleteById(id, recipientUserId);

const deleteMany = async (ids, recipientUserId) => notificationRepo.deleteMany(ids, recipientUserId);

module.exports = {
  buildListFilter,
  buildSoftDeleteUpdate,
  listForUser,
  getSettingsForUser,
  updateSettingsForUser,
  markAsRead,
  markManyAsRead,
  deleteById,
  deleteMany,
};

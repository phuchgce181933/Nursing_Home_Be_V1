const notificationRepo = require('../repositories/notificationRepository');
const User = require('../models/user');

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

const markAsRead = async (id) => notificationRepo.markAsRead(id);

const markManyAsRead = async (ids) => notificationRepo.markManyAsRead(ids);

const deleteById = async (id) => notificationRepo.deleteById(id);

const deleteMany = async (ids) => notificationRepo.deleteMany(ids);

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

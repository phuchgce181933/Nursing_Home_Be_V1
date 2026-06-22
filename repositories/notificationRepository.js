const Notification = require('../models/notification');

const insertMany = async (notifications) => Notification.insertMany(notifications);

const findByRecipient = async (recipientUserId, filter = {}, options = {}) => {
  const { page = 1, limit = 20, sort = { createdAt: -1 } } = options;
  const query = { recipientUserId, ...filter };
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Notification.find(query).sort(sort).skip(skip).limit(limit),
    Notification.countDocuments(query),
  ]);
  return { items, total, page, limit };
};

const markAsRead = async (id) => Notification.findByIdAndUpdate(id, { isRead: true, readAt: new Date() }, { new: true });

const markManyAsRead = async (ids) => Notification.updateMany({ _id: { $in: ids } }, { $set: { isRead: true, readAt: new Date() } });

const deleteById = async (id) => Notification.findByIdAndDelete(id);

const deleteMany = async (ids) => Notification.deleteMany({ _id: { $in: ids } });

module.exports = {
  insertMany,
  findByRecipient,
  markAsRead,
  markManyAsRead,
  deleteById,
  deleteMany,
};

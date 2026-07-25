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

const markAsRead = async (id, recipientUserId) =>
  Notification.findOneAndUpdate({ _id: id, recipientUserId }, { isRead: true, readAt: new Date() }, { new: true });

const markManyAsRead = async (ids, recipientUserId) =>
  Notification.updateMany({ _id: { $in: ids }, recipientUserId }, { $set: { isRead: true, readAt: new Date() } });

const deleteById = async (id, recipientUserId) => Notification.findOneAndDelete({ _id: id, recipientUserId });

const deleteMany = async (ids, recipientUserId) => Notification.deleteMany({ _id: { $in: ids }, recipientUserId });

module.exports = {
  insertMany,
  findByRecipient,
  markAsRead,
  markManyAsRead,
  deleteById,
  deleteMany,
};

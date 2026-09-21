const Notification = require('../models/notification');

const insertMany = async (notifications) => Notification.insertMany(notifications);

const findByFilter = async (filter, selectFields) => {
  let query = Notification.find(filter);
  if (selectFields) query = query.select(selectFields);
  return query;
};

const findByRecipient = async (recipientUserId, filter = {}, options = {}) => {
  const { page = 1, limit = 10, sort = { createdAt: -1 } } = options;
  const query = { recipientUserId, isDeleted: false, ...filter };
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Notification.find(query).sort(sort).skip(skip).limit(limit),
    Notification.countDocuments(query),
  ]);
  return { items, total, page, limit };
};

const markAsRead = async (id) => Notification.findOneAndUpdate({ _id: id, isDeleted: false }, { isRead: true, readAt: new Date() }, { new: true });

const markManyAsRead = async (ids) => Notification.updateMany({ _id: { $in: ids }, isDeleted: false }, { $set: { isRead: true, readAt: new Date() } });

const deleteById = async (id) => Notification.findOneAndUpdate({ _id: id, isDeleted: false }, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });

const deleteMany = async (ids) => Notification.updateMany({ _id: { $in: ids }, isDeleted: false }, { $set: { isDeleted: true, deletedAt: new Date() } });

module.exports = {
  insertMany,
  findByFilter,
  findByRecipient,
  markAsRead,
  markManyAsRead,
  deleteById,
  deleteMany,
};

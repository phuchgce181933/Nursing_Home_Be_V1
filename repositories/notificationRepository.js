const Notification = require('../models/notification');

const insertMany = async (notifications) => Notification.insertMany(notifications);

module.exports = {
  insertMany,
};

const mongoose = require('mongoose');
const { DELIVERY_CHANNELS, NOTIFICATION_CATEGORIES } = require('./enums');

const { Schema, Types } = mongoose;

const notificationSchema = new Schema(
  {
    recipientUserId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    category: { type: String, enum: NOTIFICATION_CATEGORIES, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    targetEntityType: { type: String, trim: true },
    targetEntityId: { type: Types.ObjectId },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date },
    deliveryChannels: [{ type: String, enum: DELIVERY_CHANNELS }],
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

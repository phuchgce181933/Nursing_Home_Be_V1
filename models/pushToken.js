const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const pushTokenSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, trim: true, unique: true, maxlength: 255 },
    platform: { type: String, enum: ['ios', 'android', 'web', 'unknown'], default: 'unknown' },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.models.PushToken || mongoose.model('PushToken', pushTokenSchema);

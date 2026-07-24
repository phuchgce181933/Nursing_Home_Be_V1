const mongoose = require('mongoose');
const { GENDERS, ROLES, NOTIFICATION_CATEGORIES, DELIVERY_CHANNELS } = require('./enums');

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true, index: true },
    phone: { type: String, trim: true, index: true },
    username: { type: String, trim: true, unique: true, sparse: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: ROLES, index: true },
    isActive: { type: Boolean, default: true },
    isBanned: { type: Boolean, default: false, index: true },
    banReason: { type: String, trim: true },
    lastLoginAt: { type: Date },
    avatarUrl: { type: String, trim: true },
    avatarPublicId: { type: String, trim: true },
    address: { type: String, trim: true },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: GENDERS, default: 'unknown' },
    passwordChangedAt: { type: Date },
    resetPasswordTokenHash: { type: String },
    resetPasswordExpiresAt: { type: Date },
    notificationSettings: {
      enabledCategories: [{ type: String, enum: NOTIFICATION_CATEGORIES }],
      deliveryChannels: [{ type: String, enum: DELIVERY_CHANNELS }],
      doNotDisturb: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model('User', userSchema);

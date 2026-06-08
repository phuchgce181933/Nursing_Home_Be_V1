const mongoose = require('mongoose');
const { SUPPORT_REQUEST_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const supportRequestSchema = new Schema(
  {
    familyAccountId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    subject: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    age: { type: Number, required: true, min: 0 },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    notes: { type: String, trim: true },
    status: { type: String, enum: SUPPORT_REQUEST_STATUSES, default: 'open', index: true },
    closedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.models.SupportRequest || mongoose.model('SupportRequest', supportRequestSchema);

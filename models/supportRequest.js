const mongoose = require('mongoose');
const { SUPPORT_REQUEST_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const supportRequestSchema = new Schema(
  {
    familyAccountId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    subject: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    age: { type: Number, required: true, min: 0, max: 150 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    notes: { type: String, trim: true, maxlength: 1000 },
    status: { type: String, enum: SUPPORT_REQUEST_STATUSES, default: 'open', index: true },
    closedAt: { type: Date },
    messages: [
      {
        senderId: { type: Types.ObjectId, ref: 'User' },
        senderRole: { type: String, trim: true },
        text: { type: String, required: true, trim: true, maxlength: 2000 },
        sentAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.models.SupportRequest || mongoose.model('SupportRequest', supportRequestSchema);

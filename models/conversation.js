const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const conversationSchema = new Schema(
  {
    familyAccountId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    residentId: { type: Types.ObjectId, ref: 'Resident', index: true },
    participantUserIds: [{ type: Types.ObjectId, ref: 'User', index: true }],
    subject: { type: String, trim: true },
    lastMessageAt: { type: Date, index: true },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);

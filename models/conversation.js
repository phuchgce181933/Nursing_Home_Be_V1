const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const conversationSchema = new Schema(
  {
    familyAccountId: { type: Types.ObjectId, ref: 'User', index: true },
    participantUserIds: [{ type: Types.ObjectId, ref: 'User', index: true }],
    subject: { type: String, trim: true },
    lastMessageAt: { type: Date, index: true },
    isArchived: { type: Boolean, default: false },
    // Guest info for unauthenticated family contacts
    isGuest: { type: Boolean, default: false, index: true },
    guestName: { type: String, trim: true },
    guestEmail: { type: String, trim: true },
    guestPhone: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);

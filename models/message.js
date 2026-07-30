const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const fileAttachmentSchema = new Schema(
  {
    fileName: { type: String, trim: true, maxlength: 255 },
    fileUrl: { type: String, trim: true, maxlength: 2048 },
    mimeType: { type: String, trim: true, maxlength: 255 },
    sizeInBytes: { type: Number, min: 0, max: 10 * 1024 * 1024 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const messageSchema = new Schema(
  {
    conversationId: { type: Types.ObjectId, ref: 'Conversation', required: true, index: true },
    // senderUserId may be null for guest messages
    senderUserId: { type: Types.ObjectId, ref: 'User', index: true },
    // Not required: a message can be attachment-only (e.g. a photo sent with no
    // caption) — routes/conversations.js enforces "content OR attachments" instead.
    content: { type: String, trim: true, default: '', maxlength: 5000 },
    attachments: { type: [fileAttachmentSchema], validate: [(arr) => arr.length <= 6, 'A message may have at most 6 attachments'] },
    readByUserIds: [{ type: Types.ObjectId, ref: 'User' }],
    sentAt: { type: Date, default: Date.now, index: true },
    // Optional guest sender info when senderUserId is not present
    guestName: { type: String, trim: true },
    guestEmail: { type: String, trim: true },
    guestPhone: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Message || mongoose.model('Message', messageSchema);

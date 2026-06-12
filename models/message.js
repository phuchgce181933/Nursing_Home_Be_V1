const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const fileAttachmentSchema = new Schema(
  {
    fileName: { type: String, trim: true },
    fileUrl: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    sizeInBytes: { type: Number, min: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const messageSchema = new Schema(
  {
    conversationId: { type: Types.ObjectId, ref: 'Conversation', required: true, index: true },
    // senderUserId may be null for guest messages
    senderUserId: { type: Types.ObjectId, ref: 'User', index: true },
    content: { type: String, required: true, trim: true },
    attachments: [fileAttachmentSchema],
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

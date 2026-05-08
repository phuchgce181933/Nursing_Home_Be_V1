const mongoose = require('mongoose');
const { SUPPORT_REQUEST_STATUSES } = require('./enums');

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

const supportRequestSchema = new Schema(
  {
    familyAccountId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    residentId: { type: Types.ObjectId, ref: 'Resident', index: true },
    subject: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    status: { type: String, enum: SUPPORT_REQUEST_STATUSES, default: 'open', index: true },
    attachments: [fileAttachmentSchema],
    closedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.models.SupportRequest || mongoose.model('SupportRequest', supportRequestSchema);

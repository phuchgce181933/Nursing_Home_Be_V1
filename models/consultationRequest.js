const mongoose = require('mongoose');
const { CONSULTATION_REQUEST_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const consultationRequestSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    age: { type: Number, min: 0 },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    serviceInterest: { type: String, trim: true },
    subject: { type: String, trim: true },
    message: { type: String, trim: true },
    status: { type: String, enum: CONSULTATION_REQUEST_STATUSES, default: 'open', index: true },
    adminNotes: { type: String, trim: true },
    closedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.models.ConsultationRequest || mongoose.model('ConsultationRequest', consultationRequestSchema);

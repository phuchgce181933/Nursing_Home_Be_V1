const mongoose = require('mongoose');
const { INVOICE_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const invoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, trim: true, index: true },
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    familyAccountId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    prescriptionId: { type: Types.ObjectId, ref: 'Prescription', index: true },
    billingPeriodStart: { type: Date, required: true },
    billingPeriodEnd: { type: Date, required: true },
    roomCost: { type: Number, required: true, min: 0, default: 0 },
    medicationCost: { type: Number, required: true, min: 0, default: 0 },
    careServiceCost: { type: Number, required: true, min: 0, default: 0 },
    otherCost: { type: Number, required: true, min: 0, default: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: INVOICE_STATUSES, default: 'issued', index: true },
    dueDate: { type: Date, index: true },
    issuedAt: { type: Date, default: Date.now },
    downloadedCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);

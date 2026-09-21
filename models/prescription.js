const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const PRESCRIPTION_STATUSES = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'COMPLETED', 'CANCELLED', 'EXPIRED'];
const ITEM_ROUTES = ['oral', 'injection', 'topical', 'inhaled'];

const prescriptionItemSchema = new Schema({
  medicationId: { type: Types.ObjectId, ref: 'Medication', required: true, index: true },
  medicationName: { type: String, required: true, trim: true },
  genericName: { type: String, trim: true },
  dosage: { type: String, required: true, trim: true },
  unit: { type: String, trim: true },
  quantity: { type: Number, default: 1, min: 1 },
  price: { type: Number, default: 0, min: 0 },
  taxRate: { type: Number, default: 0.05, min: 0 },
  subtotalExclTax: { type: Number, default: 0, min: 0 },
  taxAmount: { type: Number, default: 0, min: 0 },
  subtotalInclTax: { type: Number, default: 0, min: 0 },
  frequency: { type: Number, required: true, min: 1, max: 4 },
  times: [{ type: String, trim: true }],
  route: { type: String, enum: ITEM_ROUTES, default: 'oral' },
  duration: { type: Number, min: 1 },
  startDate: { type: Date },
  endDate: { type: Date },
  instructions: { type: String, trim: true },
  elderlyDosageAdjusted: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  isPRN: { type: Boolean, default: false },
  prnReason: { type: String, trim: true },
  maxDailyDoses: { type: Number, min: 1, max: 12 },
});

const editHistorySchema = new Schema(
  {
    editedBy: { type: Types.ObjectId, ref: 'User', required: true },
    editedAt: { type: Date, default: Date.now },
    changes: { type: String, required: true, trim: true },
    beforeData: { type: Schema.Types.Mixed },
    afterData: { type: Schema.Types.Mixed },
    action: { type: String, trim: true },
  },
  { _id: false }
);

const acknowledgmentSchema = new Schema(
  {
    warningType: { type: String, required: true, trim: true },
    acknowledgedBy: { type: Types.ObjectId, ref: 'User', required: true },
    acknowledgedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const prescriptionSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    doctorId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    diagnosisNote: { type: String, trim: true },
    prescriptionDate: { type: Date, required: true, default: Date.now },
    validUntil: { type: Date, required: true, index: true },
    status: { type: String, enum: PRESCRIPTION_STATUSES, default: 'ACTIVE', index: true },
    items: { type: [prescriptionItemSchema], default: [] },
    acknowledgments: { type: [acknowledgmentSchema], default: [] },
    editHistory: { type: [editHistorySchema], default: [] },
    // pharmacy verification fields
    isVerified: { type: Boolean, default: false, index: true },
    verifiedByUserId: { type: Types.ObjectId, ref: 'User' },
    verifiedAt: { type: Date },
    // lifecycle fields
    version: { type: Number, default: 1 },
    suspendedAt: { type: Date },
    suspendedBy: { type: Types.ObjectId, ref: 'User' },
    suspendedReason: { type: String, trim: true },
    expiredAt: { type: Date },
    activatedAt: { type: Date },
    activatedBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// validUntil must be within 30 days of prescriptionDate (Thông tư 52/2017/TT-BYT)
// Using async form — Mongoose 9 no longer passes `next` for validate hooks
prescriptionSchema.pre('validate', async function () {
  if (this.prescriptionDate && this.validUntil) {
    const maxValidUntil = new Date(this.prescriptionDate);
    maxValidUntil.setDate(maxValidUntil.getDate() + 30);
    if (this.validUntil > maxValidUntil) {
      throw new Error('validUntil must be within 30 days of prescriptionDate');
    }
    if (this.validUntil <= this.prescriptionDate) {
      throw new Error('validUntil must be after prescriptionDate');
    }
  }
});

module.exports = mongoose.models.Prescription || mongoose.model('Prescription', prescriptionSchema);

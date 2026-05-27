const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const PRESCRIPTION_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'];
const ITEM_ROUTES = ['oral', 'injection', 'topical', 'inhaled'];

const prescriptionItemSchema = new Schema({
  medicationName: { type: String, required: true, trim: true },
  genericName: { type: String, trim: true },
  dosage: { type: String, required: true, trim: true },
  unit: { type: String, trim: true },
  frequency: { type: Number, required: true, min: 1, max: 4 },
  times: [{ type: String, trim: true }],
  route: { type: String, enum: ITEM_ROUTES, default: 'oral' },
  duration: { type: Number, min: 1 },
  startDate: { type: Date },
  endDate: { type: Date },
  instructions: { type: String, trim: true },
  elderlyDosageAdjusted: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
});

const editHistorySchema = new Schema(
  {
    editedBy: { type: Types.ObjectId, ref: 'User', required: true },
    editedAt: { type: Date, default: Date.now },
    changes: { type: String, required: true, trim: true },
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
  },
  { timestamps: true }
);

// validUntil must be within 30 days of prescriptionDate
prescriptionSchema.pre('validate', function (next) {
  if (this.prescriptionDate && this.validUntil) {
    const maxValidUntil = new Date(this.prescriptionDate);
    maxValidUntil.setDate(maxValidUntil.getDate() + 30);
    if (this.validUntil > maxValidUntil) {
      return next(new Error('validUntil must be within 30 days of prescriptionDate'));
    }
    if (this.validUntil <= this.prescriptionDate) {
      return next(new Error('validUntil must be after prescriptionDate'));
    }
  }
  next();
});

module.exports = mongoose.models.Prescription || mongoose.model('Prescription', prescriptionSchema);

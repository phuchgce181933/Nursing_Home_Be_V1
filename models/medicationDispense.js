const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const medicationDispenseSchema = new Schema(
  {
    medicationId: { type: Types.ObjectId, ref: 'Medication', required: true, index: true },
    prescriptionId: { type: Types.ObjectId, ref: 'Prescription', index: true },
    residentId: { type: Types.ObjectId, ref: 'Resident', index: true },
    quantity: { type: Number, required: true, min: 1 },
    dispensedByUserId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    dispensedAt: { type: Date, default: Date.now, index: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.MedicationDispense || mongoose.model('MedicationDispense', medicationDispenseSchema);

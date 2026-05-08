const mongoose = require('mongoose');
const { PRESCRIPTION_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const prescriptionSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    prescribedByStaffId: { type: Types.ObjectId, ref: 'StaffProfile', required: true, index: true },
    medicationName: { type: String, required: true, trim: true, index: true },
    dosage: { type: String, required: true, trim: true },
    route: { type: String, trim: true },
    frequency: { type: String, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    scheduleTimes: [{ type: String, trim: true }],
    status: { type: String, enum: PRESCRIPTION_STATUSES, default: 'active', index: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Prescription || mongoose.model('Prescription', prescriptionSchema);

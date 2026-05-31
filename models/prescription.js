const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

// Status enum khớp với FE MedicationPage và medicationService
const PRESCRIPTION_STATUSES = ['active', 'paused', 'stopped', 'completed'];

const prescriptionSchema = new Schema(
  {
    residentId:          { type: Types.ObjectId, ref: 'Resident',      required: true, index: true },
    prescribedByStaffId: { type: Types.ObjectId, ref: 'StaffProfile',  required: true, index: true },
    medicationName:      { type: String, required: true, trim: true, index: true },
    dosage:              { type: String, required: true, trim: true },
    route:               { type: String, trim: true, default: 'Oral' },
    frequency:           { type: String, trim: true },
    scheduleTimes:       [{ type: String, trim: true }],
    startDate:           { type: Date },
    endDate:             { type: Date },
    status:              { type: String, enum: PRESCRIPTION_STATUSES, default: 'active', index: true },
    isVerified:          { type: Boolean, default: false, index: true },
    verifiedByUserId:    { type: Types.ObjectId, ref: 'User' },
    verifiedAt:          { type: Date },
    notes:               { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Prescription || mongoose.model('Prescription', prescriptionSchema);

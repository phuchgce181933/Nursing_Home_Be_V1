const mongoose = require('mongoose');
const { MEDICATION_ADMIN_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const medicationAdministrationSchema = new Schema(
  {
    prescriptionId: { type: Types.ObjectId, ref: 'Prescription', required: true, index: true },
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    scheduledAt: { type: Date, required: true, index: true },
    administeredByStaffId: { type: Types.ObjectId, ref: 'StaffProfile', index: true },
    status: { type: String, enum: MEDICATION_ADMIN_STATUSES, default: 'pending', index: true },
    takenAt: { type: Date },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.MedicationAdministration ||
  mongoose.model('MedicationAdministration', medicationAdministrationSchema);

const mongoose = require('mongoose');
const {
  ADMISSION_ELIGIBILITY_STATUSES,
  ADMISSION_STATUSES,
} = require('./enums');

const { Schema, Types } = mongoose;

const admissionSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', index: true },
    familyAccountId: { type: Types.ObjectId, ref: 'User', index: true },
    requestedByName: { type: String, trim: true },
    requestedByPhone: { type: String, trim: true },
    requestedAt: { type: Date, default: Date.now },
    consultationScheduledAt: { type: Date },
    tourScheduledAt: { type: Date },
    initialAssessmentScheduledAt: { type: Date },
    assessmentResult: { type: String, trim: true },
    eligibilityStatus: { type: String, enum: ADMISSION_ELIGIBILITY_STATUSES, default: 'pending', index: true },
    assignedServicePackage: { type: String, trim: true },
    contractNumber: { type: String, trim: true, index: true },
    contractSignedAt: { type: Date },
    checkInAt: { type: Date },
    status: { type: String, enum: ADMISSION_STATUSES, default: 'new_request', index: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Admission || mongoose.model('Admission', admissionSchema);

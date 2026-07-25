const mongoose = require('mongoose');
const {
  ADMISSION_ELIGIBILITY_STATUSES,
  ADMISSION_STATUSES,
  GENDERS,
  BLOOD_TYPES,
} = require('./enums');

const { Schema, Types } = mongoose;

const applicantSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: GENDERS, default: 'unknown' },
    citizenId: { type: String, trim: true },
    bloodType: { type: String, enum: BLOOD_TYPES, default: 'unknown' },
    personalAddress: { type: String, trim: true },
    relationshipToRequester: { type: String, required: true, trim: true },
    allergies: [{ type: String, trim: true }],
    chronicConditions: [{ type: String, trim: true }],
    initialHealthCondition: { type: String, trim: true },
    phone: { type: String, trim: true },
    avatarUrl: { type: String, trim: true },
  },
  { _id: false }
);

const admissionSchema = new Schema(
  {
    requestCode: { type: String, unique: true, uppercase: true, trim: true, index: true },
    residentId: { type: Types.ObjectId, ref: 'Resident', index: true },
    familyAccountId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    applicant: applicantSchema,
    preferredAdmissionDate: { type: Date },
    reasonForAdmission: { type: String, trim: true },
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
    cancelledAt: { type: Date },
    cancellationReason: { type: String, trim: true },
    rejectionReason: { type: String, trim: true },
    rejectedAt: { type: Date },
    approvedAt: { type: Date },
    notes: { type: String, trim: true },

    // UC-6.16: Pre-admission Consultation
    consultationNotes: { type: String, trim: true },
    consultedBy: { type: Types.ObjectId, ref: 'User' },
    consultedAt: { type: Date },

    // UC-6.18: Assign Consultant
    consultantId: { type: Types.ObjectId, ref: 'User' },

    // UC-6.17: Initial Assessment Scheduling
    initialAssessmentNotes: { type: String, trim: true },

    // UC-6.19: Evaluate Admission Eligibility
    assessedBy: { type: Types.ObjectId, ref: 'User' },
    assessedAt: { type: Date },

    // UC-6.24: Assign Service Package
    servicePackageId: { type: Types.ObjectId, ref: 'ServicePackage' },

    // UC-6.25: Contract
    contractStartDate: { type: Date },
    contractEndDate: { type: Date },
    contractDurationMonths: { type: Number, min: 1 },
    contractDiscountPercent: { type: Number, min: 0, max: 100 },
    contractTerms: { type: String, trim: true },
    contractStatus: { type: String, enum: ['active', 'cancelled'] },
    contractCancelledAt: { type: Date },
    contractCancellationReason: { type: String, trim: true },

    // UC-6.26: Check-in
    assignedBedId: { type: Types.ObjectId, ref: 'Bed' },
    assignedRoomId: { type: Types.ObjectId, ref: 'Room' },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Admission || mongoose.model('Admission', admissionSchema);

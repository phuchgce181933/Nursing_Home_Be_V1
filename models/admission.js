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
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Admission || mongoose.model('Admission', admissionSchema);

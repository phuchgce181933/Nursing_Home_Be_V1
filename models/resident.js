const mongoose = require('mongoose');
const { BLOOD_TYPES, GENDERS, RESIDENCY_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const emergencyContactSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    relationship: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    isPrimary: { type: Boolean, default: false },
  }
);

const residentSchema = new Schema(
  {
    residentCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    fullName: { type: String, required: true, trim: true, index: true },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: GENDERS, default: 'unknown' },
    citizenId: { type: String, trim: true, index: true },
    insuranceNumber: { type: String, trim: true, index: true },
    bloodType: { type: String, enum: BLOOD_TYPES, default: 'unknown' },
    personalAddress: { type: String, trim: true },
    avatarUrl: { type: String, trim: true },
    emergencyContacts: [emergencyContactSchema],
    allergies: [{ type: String, trim: true }],
    drugAllergies: [{ type: String, trim: true }],
    chronicConditions: [{ type: String, trim: true }],
    medicalHistory: [{ type: String, trim: true }],
    initialHealthCondition: { type: String, trim: true },
    bedId: { type: Types.ObjectId, ref: 'Bed', index: true },
    roomId: { type: Types.ObjectId, ref: 'Room', index: true },
    residencyStatus: { type: String, enum: RESIDENCY_STATUSES, default: 'pending', index: true },
    admittedAt: { type: Date },
    dischargedAt: { type: Date },
    servicePackage: { type: String, trim: true },
    familyPortalAccountIds: [{ type: Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

module.exports = mongoose.models.Resident || mongoose.model('Resident', residentSchema);

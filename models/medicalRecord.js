const mongoose = require('mongoose');
const { PAYMENT_METHODS } = require('./enums');

const { Schema, Types } = mongoose;

const medicalRecordSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    createdByStaffId: { type: Types.ObjectId, ref: 'StaffProfile', index: true },
    measuredAt: { type: Date, default: Date.now, index: true },
    bloodPressureSystolic: { type: Number, min: 0 },
    bloodPressureDiastolic: { type: Number, min: 0 },
    pulse: { type: Number, min: 0 },
    temperatureCelsius: { type: Number, min: 30, max: 45 },
    oxygenSaturation: { type: Number, min: 0, max: 100 },
    bloodSugar: { type: Number, min: 0 },
    weightKg: { type: Number, min: 0 },
    heightCm: { type: Number, min: 0 },
    physicalExamination: { type: String, trim: true },
    laboratoryTestResults: { type: String, trim: true },
    urinalysisResults: { type: String, trim: true },
    ecgResults: { type: String, trim: true },
    imagingResults: { type: String, trim: true },
    cognitiveFunction: { type: String, trim: true },
    functionalStatus: { type: String, trim: true },
    fallRisk: { type: String, trim: true },
    nutritionalStatus: { type: String, trim: true },
    roomCost: { type: Number, min: 0, default: 0 },
    medicationCost: { type: Number, min: 0, default: 0 },
    careServiceCost: { type: Number, min: 0, default: 0 },
    otherCost: { type: Number, min: 0, default: 0 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS },
    consentToPayment: { type: Boolean, default: false },
    invoiceId: { type: Types.ObjectId, ref: 'Invoice', index: true },
    abnormalFlag: { type: Boolean, default: false, index: true },
    summary: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.MedicalRecord || mongoose.model('MedicalRecord', medicalRecordSchema);

const mongoose = require('mongoose');

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
    abnormalFlag: { type: Boolean, default: false, index: true },
    summary: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.MedicalRecord || mongoose.model('MedicalRecord', medicalRecordSchema);

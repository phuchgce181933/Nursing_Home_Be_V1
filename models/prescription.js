const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

// Unified status — UPPERCASE used by prescriptionController (System B)
// medicationService (System A) also uses UPPERCASE after the fix
const PRESCRIPTION_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED', 'PAUSED'];

// Sub-document: one medication line inside a complex prescription (System B)
const prescriptionItemSchema = new Schema(
  {
    medicationName:       { type: String, required: true, trim: true },
    genericName:          { type: String, trim: true },
    dosage:               { type: String, required: true, trim: true },
    unit:                 { type: String, trim: true },
    frequency:            { type: Number, min: 1, max: 4 },
    times:                [{ type: String, trim: true }],
    route:                { type: String, enum: ['oral', 'injection', 'topical', 'inhaled'], default: 'oral' },
    duration:             { type: Number },
    startDate:            { type: Date },
    endDate:              { type: Date },
    instructions:         { type: String, trim: true },
    elderlyDosageAdjusted:{ type: Boolean, default: false },
    isActive:             { type: Boolean, default: true },
  },
  { _id: true }
);

const acknowledgmentSchema = new Schema(
  {
    warningType:    { type: String, trim: true },
    acknowledgedBy: { type: Types.ObjectId, ref: 'User' },
    acknowledgedAt: { type: Date },
  },
  { _id: false }
);

const editHistorySchema = new Schema(
  {
    editedBy:  { type: Types.ObjectId, ref: 'User' },
    editedAt:  { type: Date },
    changes:   { type: String, trim: true },
  },
  { _id: false }
);

const prescriptionSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },

    // ── System B fields (prescriptionController / doctor complex workflow) ──────
    doctorId:        { type: Types.ObjectId, ref: 'User', index: true },
    diagnosisNote:   { type: String, trim: true },
    prescriptionDate:{ type: Date, default: Date.now, index: true },
    validUntil:      { type: Date },
    items:           [prescriptionItemSchema],
    acknowledgments: [acknowledgmentSchema],
    editHistory:     [editHistorySchema],

    // ── System A fields (medicationService / simple single-medication flow) ────
    // prescribedByStaffId is kept for backward compatibility with existing records
    prescribedByStaffId: { type: Types.ObjectId, ref: 'StaffProfile', index: true },
    medicationName:      { type: String, trim: true, index: true },
    dosage:              { type: String, trim: true },
    route:               { type: String, trim: true },
    frequency:           { type: String, trim: true },
    scheduleTimes:       [{ type: String, trim: true }],
    startDate:           { type: Date },
    endDate:             { type: Date },
    notes:               { type: String, trim: true },

    // ── Shared ────────────────────────────────────────────────────────────────
    status: { type: String, enum: PRESCRIPTION_STATUSES, default: 'ACTIVE', index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Prescription || mongoose.model('Prescription', prescriptionSchema);

const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const medicationNoteSchema = new Schema(
  {
    medicationId: { type: Types.ObjectId, ref: 'Medication', required: true, index: true },
    note: { type: String, required: true, trim: true },
    createdBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.models.MedicationNote || mongoose.model('MedicationNote', medicationNoteSchema);

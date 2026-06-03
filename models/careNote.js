const mongoose = require('mongoose');
const { CARE_NOTE_TYPES } = require('./enums');

const { Schema, Types } = mongoose;

const careNoteSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    authorStaffId: { type: Types.ObjectId, ref: 'StaffProfile', required: true, index: true },
    noteType: { type: String, enum: CARE_NOTE_TYPES, default: 'general', index: true },
    content: { type: String, required: true, trim: true },
    noteAt: { type: Date, default: Date.now, index: true },
    // Structured data specific to noteType:
    // meal:     { mealType, intakeAmount, appetite }
    // activity: { activityType, duration, participationLevel, mood }
    // health:   { symptoms, consciousness, fallRisk, skinCondition, observations }
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.models.CareNote || mongoose.model('CareNote', careNoteSchema);

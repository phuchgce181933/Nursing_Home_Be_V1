const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const REHAB_SESSION_TYPES = [
  'physical_therapy',
  'occupational_therapy',
  'speech_therapy',
  'mobility_training',
  'balance_training',
  'group_exercise',
  'other',
];

const rehabilitationScheduleEntrySchema = new Schema(
  {
    rehabilitationScheduleDayId: {
      type: Types.ObjectId,
      ref: 'RehabilitationScheduleDay',
      required: true,
      index: true,
    },
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    sessionType: { type: String, enum: REHAB_SESSION_TYPES, required: true, index: true },
    scheduledTime: { type: String, required: true, trim: true },
    durationMinutes: { type: Number, min: 1 },
    location: { type: String, trim: true },
    sessionTitle: { type: String, trim: true },
    therapyGoals: { type: String, trim: true },
    caregiverAssistNote: { type: String, trim: true },
    leadStaffName: { type: String, trim: true },
  },
  { timestamps: true }
);

rehabilitationScheduleEntrySchema.index({ rehabilitationScheduleDayId: 1, residentId: 1, scheduledTime: 1 });

module.exports =
  mongoose.models.RehabilitationScheduleEntry ||
  mongoose.model('RehabilitationScheduleEntry', rehabilitationScheduleEntrySchema);

module.exports.REHAB_SESSION_TYPES = REHAB_SESSION_TYPES;

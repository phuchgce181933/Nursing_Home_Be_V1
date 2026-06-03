const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const OBSERVATION_CATEGORIES = ['mood', 'behavior', 'abnormal'];
const MOOD_LEVELS = ['calm', 'happy', 'neutral', 'anxious', 'sad', 'agitated', 'confused', 'irritable'];
const BEHAVIOR_TYPES = [
  'cooperative',
  'withdrawn',
  'restless',
  'wandering',
  'verbal_outburst',
  'physical_resistance',
  'sleep_disturbance',
  'appetite_change',
  'social_withdrawal',
  'repetitive_behavior',
  'other',
];
const SEVERITY_LEVELS = ['normal', 'mild', 'moderate', 'urgent'];

const dailyBehaviorRecordSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    workDate: { type: Date, required: true, index: true },
    observedAt: { type: Date, required: true, index: true },
    observationCategory: { type: String, enum: OBSERVATION_CATEGORIES, required: true, index: true },
    moodLevel: { type: String, enum: MOOD_LEVELS },
    behaviorType: { type: String, enum: BEHAVIOR_TYPES },
    severity: { type: String, enum: SEVERITY_LEVELS, default: 'normal', index: true },
    notes: { type: String, required: true, trim: true },
    recordedByStaffId: { type: Types.ObjectId, ref: 'StaffProfile', required: true, index: true },
    recordedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

dailyBehaviorRecordSchema.index({ residentId: 1, workDate: 1, observedAt: -1 });

module.exports =
  mongoose.models.DailyBehaviorRecord ||
  mongoose.model('DailyBehaviorRecord', dailyBehaviorRecordSchema);

module.exports.OBSERVATION_CATEGORIES = OBSERVATION_CATEGORIES;
module.exports.MOOD_LEVELS = MOOD_LEVELS;
module.exports.BEHAVIOR_TYPES = BEHAVIOR_TYPES;
module.exports.SEVERITY_LEVELS = SEVERITY_LEVELS;

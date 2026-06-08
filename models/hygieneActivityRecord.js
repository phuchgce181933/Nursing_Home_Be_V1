const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const HYGIENE_CATEGORIES = ['personal', 'environment'];
const HYGIENE_ACTIVITY_TYPES = [
  'bathing',
  'oral_care',
  'grooming',
  'toileting',
  'diaper_change',
  'room_tidy',
  'bathroom_clean',
  'linen_change',
  'laundry',
];
const COMPLETION_STATUSES = ['completed', 'partial', 'refused', 'assisted'];

const hygieneActivityRecordSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    workDate: { type: Date, required: true, index: true },
    activityCategory: { type: String, enum: HYGIENE_CATEGORIES, required: true, index: true },
    activityType: { type: String, enum: HYGIENE_ACTIVITY_TYPES, required: true, index: true },
    completionStatus: { type: String, enum: COMPLETION_STATUSES, required: true },
    notes: { type: String, trim: true },
    recordedByStaffId: { type: Types.ObjectId, ref: 'StaffProfile', required: true, index: true },
    recordedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

hygieneActivityRecordSchema.index({ residentId: 1, workDate: 1, activityType: 1 }, { unique: true });

module.exports =
  mongoose.models.HygieneActivityRecord ||
  mongoose.model('HygieneActivityRecord', hygieneActivityRecordSchema);

module.exports.HYGIENE_CATEGORIES = HYGIENE_CATEGORIES;
module.exports.HYGIENE_ACTIVITY_TYPES = HYGIENE_ACTIVITY_TYPES;
module.exports.COMPLETION_STATUSES = COMPLETION_STATUSES;

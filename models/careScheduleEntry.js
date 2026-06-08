const mongoose = require('mongoose');
const { CARE_TASK_TYPES, CARE_LEVELS } = require('./enums');

const { Schema, Types } = mongoose;

const careScheduleEntrySchema = new Schema(
  {
    careScheduleDayId: { type: Types.ObjectId, ref: 'CareScheduleDay', required: true, index: true },
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    staffProfileId: { type: Types.ObjectId, ref: 'StaffProfile', required: true, index: true },
    shiftId: { type: Types.ObjectId, ref: 'Shift', required: true, index: true },
    taskType: { type: String, required: true, enum: CARE_TASK_TYPES },
    careLevel: { type: String, required: true, enum: CARE_LEVELS },
    scheduledTime: { type: String, required: true, trim: true },
    notes: { type: String, trim: true },
    source: { type: String, enum: ['template', 'manual'], default: 'manual' },
    templateKey: { type: String, trim: true },
  },
  { timestamps: true }
);

careScheduleEntrySchema.index({ careScheduleDayId: 1, residentId: 1, scheduledTime: 1 });

module.exports =
  mongoose.models.CareScheduleEntry || mongoose.model('CareScheduleEntry', careScheduleEntrySchema);


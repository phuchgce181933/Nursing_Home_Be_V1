const mongoose = require('mongoose');
const { CARE_TASK_TYPES, CARE_TASK_STATUSES, CARE_LEVELS } = require('./enums');

const { Schema, Types } = mongoose;

const careTaskSchema = new Schema(
  {
    staffProfileId: { type: Types.ObjectId, ref: 'StaffProfile', required: true, index: true },
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    shiftId: { type: Types.ObjectId, ref: 'Shift' },
    taskType: { type: String, required: true, enum: CARE_TASK_TYPES },
    careLevel: { type: String, required: true, enum: CARE_LEVELS },
    workDate: { type: Date, required: true, index: true },
    scheduledTime: { type: String, trim: true },
    status: { type: String, enum: CARE_TASK_STATUSES, default: 'pending', index: true },
    notes: { type: String, trim: true },
    assignedBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

careTaskSchema.index({ staffProfileId: 1, workDate: 1 });
careTaskSchema.index({ shiftId: 1, status: 1 });

module.exports = mongoose.models.CareTask || mongoose.model('CareTask', careTaskSchema);

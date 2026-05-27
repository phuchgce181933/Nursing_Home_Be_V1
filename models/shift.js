const mongoose = require('mongoose');
const { SHIFT_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const changeLogEntrySchema = new Schema(
  {
    changedBy: { type: Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    fieldsChanged: [{ type: String }],
    oldValues: { type: Schema.Types.Mixed },
    newValues: { type: Schema.Types.Mixed },
    reason: { type: String, trim: true },
  },
  { _id: false }
);

const shiftSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
    workDate: { type: Date, required: true, index: true },
    assignedStaffId: { type: Types.ObjectId, ref: 'StaffProfile', required: true, index: true },
    floorId: { type: Types.ObjectId, ref: 'Floor' },
    roomId: { type: Types.ObjectId, ref: 'Room' },
    shiftTemplateId: { type: Types.ObjectId, ref: 'ShiftTemplate' },
    taskDescription: { type: String, trim: true },
    status: { type: String, enum: SHIFT_STATUSES, default: 'draft', index: true },
    publishedAt: { type: Date },
    changeReason: { type: String, trim: true },
    changeLog: [changeLogEntrySchema],
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

shiftSchema.index({ assignedStaffId: 1, workDate: 1, startTime: 1, endTime: 1 });

module.exports = mongoose.models.Shift || mongoose.model('Shift', shiftSchema);

const mongoose = require('mongoose');
const { SHIFT_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const shiftSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
    workDate: { type: Date, required: true, index: true },
    assignedStaffId: { type: Types.ObjectId, ref: 'StaffProfile', required: true, index: true },
    floorId: { type: Types.ObjectId, ref: 'Floor' },
    roomId: { type: Types.ObjectId, ref: 'Room' },
    status: { type: String, enum: SHIFT_STATUSES, default: 'scheduled', index: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

shiftSchema.index({ assignedStaffId: 1, workDate: 1, startTime: 1, endTime: 1 });

module.exports = mongoose.models.Shift || mongoose.model('Shift', shiftSchema);

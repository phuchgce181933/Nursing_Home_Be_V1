const mongoose = require('mongoose');
const { LEAVE_REQUEST_TYPES, LEAVE_REQUEST_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const leaveRequestSchema = new Schema(
  {
    staffId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true, enum: LEAVE_REQUEST_TYPES },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    reason: { type: String, required: true, trim: true },
    status: { type: String, enum: LEAVE_REQUEST_STATUSES, default: 'pending', index: true },
    reviewedBy: { type: Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNote: { type: String, trim: true },
    daysRequested: { type: Number },
    replacementStaffProfileId: { type: Types.ObjectId, ref: 'StaffProfile' },
    replacementAssignedAt: { type: Date },
  },
  { timestamps: true }
);

leaveRequestSchema.index({ staffId: 1, status: 1 });
leaveRequestSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.models.LeaveRequest || mongoose.model('LeaveRequest', leaveRequestSchema);

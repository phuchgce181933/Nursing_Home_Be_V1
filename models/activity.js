const mongoose = require('mongoose');
const { ACTIVITY_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const activitySchema = new Schema(
  {
    title: { type: String, required: true, trim: true, index: true },
    category: { type: String, trim: true, index: true },
    description: { type: String, trim: true },
    scheduledAt: { type: Date, required: true, index: true },
    endAt: { type: Date, index: true },
    durationMinutes: { type: Number, min: 1 },
    location: { type: String, trim: true },
    organizerStaffId: { type: Types.ObjectId, ref: 'StaffProfile' },
    participantResidentIds: [{ type: Types.ObjectId, ref: 'Resident' }],
    attendanceRecords: [{
      residentId: { type: Types.ObjectId, ref: 'Resident' },
      occurrenceDate: { type: Date },
      status: { type: String, enum: ['present', 'absent', 'late', 'left_early'], default: 'present' },
      note: { type: String, trim: true },
    }],
    participationRecords: [{
      residentId: { type: Types.ObjectId, ref: 'Resident' },
      occurrenceDate: { type: Date },
      participationLevel: { type: String, enum: ['active', 'partial', 'passive'], default: 'active' },
      comment: { type: String, trim: true },
      incident: { type: String, trim: true },
    }],
    participantResultNotes: { type: String, trim: true },
    status: { type: String, enum: ACTIVITY_STATUSES, default: 'scheduled', index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Activity || mongoose.model('Activity', activitySchema);

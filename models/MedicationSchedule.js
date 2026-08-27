const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const SCHEDULE_STATUSES = ['PENDING', 'TAKEN', 'LATE_TAKEN', 'MISSED', 'SKIPPED', 'OVERDUE', 'REFUSED', 'HELD', 'NOT_AVAILABLE', 'DISCONTINUED'];

const medicationScheduleSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    prescriptionId: { type: Types.ObjectId, ref: 'Prescription', required: true, index: true },
    prescriptionItemId: { type: Types.ObjectId, required: true },
    medicationName: { type: String, required: true, trim: true },
    dosage: { type: String, required: true, trim: true },
    route: { type: String, trim: true },
    scheduledTime: { type: Date, required: true, index: true },
    status: { type: String, enum: SCHEDULE_STATUSES, default: 'PENDING', index: true },
    markedBy: { type: Types.ObjectId, ref: 'User' },
    markedAt: { type: Date },
    actualTimeTaken: { type: Date },
    administrationTiming: { type: String, enum: ['early', 'on_time', 'late'] },
    missedReason: { type: String, trim: true },
    notes: { type: String, trim: true },
    isPRN: { type: Boolean, default: false },
    prnReason: { type: String, trim: true },
    refusedReason: { type: String, trim: true },
    heldReason: { type: String, trim: true },
    notAvailableReason: { type: String, trim: true },
  },
  { timestamps: true }
);

medicationScheduleSchema.index({ residentId: 1, scheduledTime: 1 });

module.exports =
  mongoose.models.MedicationSchedule ||
  mongoose.model('MedicationSchedule', medicationScheduleSchema);

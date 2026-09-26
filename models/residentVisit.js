const mongoose = require('mongoose');
const { RESIDENT_VISIT_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const residentVisitSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    familyAccountId: { type: Types.ObjectId, ref: 'User', required: true, index: true },

    visitorName: { type: String, required: true, trim: true },
    visitorPhone: { type: String, required: true, trim: true },

    requestedDate: { type: Date, required: true },
    requestedTimeSlot: { type: String, trim: true },
    numberOfVisitors: { type: Number, default: 1, min: 1, max: 20 },
    notes: { type: String, trim: true },

    status: {
      type: String,
      enum: RESIDENT_VISIT_STATUSES,
      default: 'pending',
      index: true,
    },

    cancellationReason: { type: String, trim: true },
    cancelledAt: { type: Date },

    reviewedBy: { type: Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.ResidentVisit ||
  mongoose.model('ResidentVisit', residentVisitSchema);

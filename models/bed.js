const mongoose = require('mongoose');
const { BED_CONDITIONS, BED_STATUSES, BED_TYPES } = require('./enums');

const { Schema, Types } = mongoose;

const bedSchema = new Schema(
  {
    roomId: { type: Types.ObjectId, ref: 'Room', required: true, index: true },
    bedCode: { type: String, required: true, trim: true },
    bedType: { type: String, enum: BED_TYPES, default: 'normal' },
    status: { type: String, enum: BED_STATUSES, default: 'available', index: true },
    condition: { type: String, enum: BED_CONDITIONS, default: 'good' },
    assignedResidentId: { type: Types.ObjectId, ref: 'Resident', index: true },
    assignedAt: { type: Date },
    releasedAt: { type: Date },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

bedSchema.index({ roomId: 1, bedCode: 1 }, { unique: true });

module.exports = mongoose.models.Bed || mongoose.model('Bed', bedSchema);

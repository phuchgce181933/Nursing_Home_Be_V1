const mongoose = require('mongoose');
const { ROOM_STATUSES, ROOM_TYPES } = require('./enums');

const { Schema, Types } = mongoose;

const roomSchema = new Schema(
  {
    buildingId: { type: Types.ObjectId, ref: 'Building', required: true, index: true },
    floorId: { type: Types.ObjectId, ref: 'Floor', required: true, index: true },
    roomNumber: { type: String, required: true, trim: true },
    roomType: { type: String, enum: ROOM_TYPES, default: 'standard' },
    capacity: { type: Number, required: true, min: 1 },
    occupiedCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ROOM_STATUSES, default: 'available', index: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

roomSchema.index({ floorId: 1, roomNumber: 1 }, { unique: true });

module.exports = mongoose.models.Room || mongoose.model('Room', roomSchema);

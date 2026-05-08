const mongoose = require('mongoose');
const { EQUIPMENT_LOCATION_TYPES, EQUIPMENT_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const equipmentSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, trim: true, index: true },
    status: { type: String, enum: EQUIPMENT_STATUSES, default: 'available', index: true },
    locationType: { type: String, enum: EQUIPMENT_LOCATION_TYPES, default: 'storage' },
    buildingId: { type: Types.ObjectId, ref: 'Building' },
    floorId: { type: Types.ObjectId, ref: 'Floor' },
    roomId: { type: Types.ObjectId, ref: 'Room' },
    bedId: { type: Types.ObjectId, ref: 'Bed' },
    maintenanceDueAt: { type: Date },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Equipment || mongoose.model('Equipment', equipmentSchema);

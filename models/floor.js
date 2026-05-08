const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const floorSchema = new Schema(
  {
    buildingId: { type: Types.ObjectId, ref: 'Building', required: true, index: true },
    floorNumber: { type: Number, required: true },
    name: { type: String, trim: true },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

floorSchema.index({ buildingId: 1, floorNumber: 1 }, { unique: true });

module.exports = mongoose.models.Floor || mongoose.model('Floor', floorSchema);

const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const medicationSchema = new Schema(
  {
    medicationCode: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    form: { type: String, trim: true },
    strength: { type: String, trim: true },
    unit: { type: String, trim: true },
    manufacturer: { type: String, trim: true, index: true },
    description: { type: String, trim: true },
    minStockLevel: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Types.ObjectId, ref: 'User' },
    updatedBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Medication || mongoose.model('Medication', medicationSchema);

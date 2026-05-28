const mongoose = require('mongoose');
const { SERVICE_PACKAGE_TIERS } = require('./enums');

const { Schema, Types } = mongoose;

const servicePackageSchema = new Schema(
  {
    packageCode: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    tier: { type: String, enum: SERVICE_PACKAGE_TIERS, default: 'standard', index: true },
    services: [{ type: String, trim: true }],
    monthlyPrice: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Types.ObjectId, ref: 'User' },
    updatedBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.models.ServicePackage || mongoose.model('ServicePackage', servicePackageSchema);

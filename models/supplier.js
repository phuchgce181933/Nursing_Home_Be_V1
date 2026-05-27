const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const supplierSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    contactName: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    notes: { type: String, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Types.ObjectId, ref: 'User' },
    updatedBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Supplier || mongoose.model('Supplier', supplierSchema);

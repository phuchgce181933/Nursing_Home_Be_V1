const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const medicationStockSchema = new Schema(
  {
    medicationId: { type: Types.ObjectId, ref: 'Medication', required: true, index: true },
    supplierId: { type: Types.ObjectId, ref: 'Supplier', index: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, trim: true },
    lotNumber: { type: String, trim: true, index: true },
    expiryDate: { type: Date, index: true },
    receivedDate: { type: Date, default: Date.now, index: true },
    costPerUnit: { type: Number, min: 0 },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.MedicationStock || mongoose.model('MedicationStock', medicationStockSchema);

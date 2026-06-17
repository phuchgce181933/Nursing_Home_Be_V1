const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

const clinicalServiceSchema = new Schema(
  {
    serviceCode: { type: String, required: true, unique: true, trim: true, index: true },
    serviceName: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, index: true },
    description: { type: String, trim: true },
    unitPrice: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Use synchronous pre-save hook (no `next` callback) to avoid Kareem "next is not a function" errors
clinicalServiceSchema.pre('save', function () {
  this.updatedAt = new Date();
});

module.exports = mongoose.models.ClinicalService || mongoose.model('ClinicalService', clinicalServiceSchema);

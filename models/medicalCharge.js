const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

const medicalChargeSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    serviceId: { type: Types.ObjectId, ref: 'ClinicalService', index: true },
    serviceCode: { type: String, trim: true, index: true },
    serviceName: { type: String, required: true, trim: true },
    category: { type: String, trim: true, index: true },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    totalPrice: { type: Number, default: 0 },
    performedBy: { type: String, trim: true },
    performedById: { type: Types.ObjectId, ref: 'User' },
    performedAt: { type: Date, default: Date.now, index: true },
    billingStatus: { type: String, enum: ['PENDING', 'BILLED', 'PAID', 'CANCELLED'], default: 'PENDING', index: true },
    invoiceId: { type: Types.ObjectId, ref: 'Invoice', index: true },
    originType: { type: String, trim: true },
    originId: { type: Types.ObjectId, index: true },
    metadata: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

medicalChargeSchema.pre('save', function () {
  this.updatedAt = new Date();
  this.totalPrice = (this.unitPrice || 0) * (this.quantity || 1);
});

module.exports = mongoose.models.MedicalCharge || mongoose.model('MedicalCharge', medicalChargeSchema);

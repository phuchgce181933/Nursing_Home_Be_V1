const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

const invoiceSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    invoiceNumber: { type: String, trim: true, index: true },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    items: [
      {
        chargeId: { type: Types.ObjectId, ref: 'MedicalCharge' },
        description: { type: String },
        amount: { type: Number, default: 0 },
        category: { type: String },
      },
    ],
    subTotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    familyAccountId: { type: Types.ObjectId, ref: 'User', index: true },
    status: { type: String, enum: ['DRAFT', 'ISSUED', 'PAID', 'CANCELLED'], default: 'DRAFT', index: true },
    createdBy: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

invoiceSchema.pre('save', function () {
  this.updatedAt = new Date();

  if (Array.isArray(this.items) && this.items.length > 0) {
    this.subTotal = (this.items || []).reduce((s, it) => s + (it.amount || 0), 0);
    this.total = (this.subTotal || 0) + (this.tax || 0);
    this.totalAmount = this.total;
  } else {
    this.subTotal = 0;
    this.total = this.totalAmount || 0;
  }
});

module.exports = mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);

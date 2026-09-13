const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

const invoiceSchema = new Schema(
  {
    // References
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    contractId: { type: Types.ObjectId, ref: 'Contract', index: true },
    admissionId: { type: Types.ObjectId, ref: 'Admission', index: true },
    familyAccountId: { type: Types.ObjectId, ref: 'User', index: true },
    
    invoiceNumber: { type: String, trim: true, index: true },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    billingPeriodStart: { type: Date },
    billingPeriodEnd: { type: Date },
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
    originalTotalAmount: { type: Number, default: 0 },
    remainingAmount: { type: Number, default: 0 },
    familyAccountId: { type: Types.ObjectId, ref: 'User', index: true },
    status: { type: String, enum: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'], default: 'DRAFT', index: true },
    cancellationReason: { type: String, trim: true },

    // Soft-delete (admin-only "Dừng" cho hóa đơn DRAFT trước khi xuất).
    // Hóa đơn đã soft-delete không hiển thị trong danh sách mặc định nhưng
    // vẫn còn trong DB để tra cứu lịch sử.
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: Types.ObjectId, ref: 'User', default: null },

    createdBy: { type: String },
    
    // Service fee components
    roomCost: { type: Number, default: 0 },
    medicationCost: { type: Number, default: 0 },
    careServiceCost: { type: Number, default: 0 },
    otherCost: { type: Number, default: 0 },
    
    // Invoice metadata
    type: { type: String, enum: ['SERVICE', 'MEDICATION', 'OTHER', 'COMBINED'], default: 'COMBINED' },
    paymentPlan: { type: String, enum: ['FULL', 'HALF_NOW', 'MONTHLY'], default: 'MONTHLY' },
    prescriptionId: { type: Types.ObjectId, ref: 'Prescription' },
    dueDate: { type: Date },

    // Set when a PayOS checkout is created for this invoice; used to verify the real payment
    // status with PayOS before marking the invoice paid (never trust client-supplied status alone).
    payosOrderCode: { type: Number, index: true },
    issuedAt: { type: Date, default: Date.now, index: true },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

invoiceSchema.pre('save', function () {
  this.updatedAt = new Date();
  if (!this.issuedAt) {
    this.issuedAt = this.createdAt || new Date();
  }

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

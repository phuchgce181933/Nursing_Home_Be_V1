const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

const contractSchema = new Schema(
  {
    // Contract identification
    contractNumber: { type: String, required: true, trim: true, index: true },
    
    // References
    admissionId: { type: Types.ObjectId, ref: 'Admission', required: true, index: true },
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    familyAccountId: { type: Types.ObjectId, ref: 'User', index: true },
    servicePackageId: { type: Types.ObjectId, ref: 'ServicePackage' },
    roomId: { type: Types.ObjectId, ref: 'Room' },
    bedId: { type: Types.ObjectId, ref: 'Bed' },
    
    // Contract dates
    signedAt: { type: Date, default: Date.now },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    durationMonths: { type: Number, min: 1, required: true },
    
    // Financial terms
    discountPercent: { type: Number, min: 0, max: 100, default: 0 },
    monthlyFee: { type: Number, default: 0 }, // Computed from service package

    // Payment plan chosen at contract creation
    //   FULL      → Thanh toán tất cả (một lần / trước)
    //   HALF_NOW  → Thanh toán 50% ngay, 50% còn lại ghi nhận remaining
    //   MONTHLY   → Thanh toán theo tháng (mỗi hóa đơn tháng là một kỳ riêng)
    paymentPlan: {
      type: String,
      enum: ['FULL', 'HALF_NOW', 'MONTHLY'],
      default: 'MONTHLY',
      index: true,
    },
    
    // Terms and conditions
    terms: { type: String, trim: true },
    notes: { type: String, trim: true },
    
    // Contract status
    status: { 
      type: String, 
      enum: ['draft', 'active', 'expired', 'cancelled', 'terminated'], 
      default: 'active',
      index: true 
    },
    
    // Cancellation info
    cancelledAt: { type: Date },
    cancellationReason: { type: String, trim: true },
    cancelledBy: { type: Types.ObjectId, ref: 'User' },
    
    // Renewal info (link to previous contract)
    previousContractId: { type: Types.ObjectId, ref: 'Contract' },
    isRenewal: { type: Boolean, default: false },
    
    // Created by
    createdBy: { type: Types.ObjectId, ref: 'User' },
  },
  { 
    timestamps: true,
    collection: 'contracts' 
  }
);

// Index for efficient queries
contractSchema.index({ admissionId: 1, status: 1 });
contractSchema.index({ residentId: 1, status: 1 });
contractSchema.index({ familyAccountId: 1, createdAt: -1 });

// Pre-save validation
contractSchema.pre('save', function () {
  // Auto-generate contract number if not provided
  if (!this.contractNumber) {
    const year = new Date().getFullYear();
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    this.contractNumber = `HD-${year}-${timestamp}-${random}`;
  }

  // Calculate duration if not set
  if (this.startDate && this.endDate && !this.durationMonths) {
    const months = Math.ceil(
      (this.endDate.getTime() - this.startDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
    );
    this.durationMonths = Math.max(1, months);
  }
});

module.exports = mongoose.models.Contract || mongoose.model('Contract', contractSchema);

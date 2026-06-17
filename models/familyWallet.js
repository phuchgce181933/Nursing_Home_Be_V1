const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const familyWalletSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    balance: { type: Number, default: 0, min: 0 },
    totalTopup: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    transactions: [
      {
        type: { type: String, enum: ['topup', 'payment', 'refund'], required: true },
        amount: { type: Number, required: true },
        description: { type: String, trim: true },
        invoiceId: { type: Types.ObjectId, ref: 'Invoice' },
        paymentId: { type: String, trim: true },
        orderCode: { type: Number }, // PayOS orderCode — used to verify payment status via API
        status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.models.FamilyWallet || mongoose.model('FamilyWallet', familyWalletSchema);

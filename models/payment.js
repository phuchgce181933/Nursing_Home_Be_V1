const mongoose = require('mongoose');
const { PAYMENT_METHODS, PAYMENT_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const paymentSchema = new Schema(
  {
    invoiceId: { type: Types.ObjectId, ref: 'Invoice', required: true, index: true },
    paidByFamilyAccountId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    transactionRef: { type: String, trim: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'pending', index: true },
    paidAt: { type: Date },
    confirmedAt: { type: Date },
    note: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);

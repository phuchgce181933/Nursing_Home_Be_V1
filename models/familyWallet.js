const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

/**
 * Sổ cái tài chính của người nhà.
 *
 * `transactions` là LỊCH SỬ GIAO DỊCH DUY NHẤT của hệ thống — không tạo thêm
 * collection thứ hai. Mọi dòng tiền liên quan tới một tài khoản family đều
 * được ghi ở đây, kể cả khoản thanh toán hoá đơn trả thẳng qua PayOS (tiền
 * không đi qua ví). Phân biệt bằng `walletAffected`/`direction`, KHÔNG bằng
 * việc thiếu bản ghi.
 *
 * Enum `type` và `status` giữ nguyên giá trị cũ để không phá dữ liệu đã có;
 * các trường bổ sung đều optional nên bản ghi cũ vẫn đọc được bình thường.
 */
const walletTransactionSchema = new Schema(
  {
    type: { type: String, enum: ['topup', 'payment', 'refund'], required: true },

    /**
     * Chiều tiền so với SỐ DƯ VÍ:
     *  - credit : ví tăng (nạp tiền, hoàn tiền)
     *  - debit  : ví giảm (trả hoá đơn bằng ví)
     *  - none   : ví KHÔNG đổi (trả hoá đơn thẳng qua PayOS) — vẫn phải có
     *             bản ghi để lịch sử tài chính đầy đủ, nhưng tuyệt đối không
     *             được hiển thị như một khoản trừ ví.
     */
    direction: { type: String, enum: ['credit', 'debit', 'none'], default: undefined },

    /** Kênh tiền thực sự đi qua. 'wallet' = trừ số dư, 'payos' = cổng ngoài. */
    paymentMethod: { type: String, enum: ['wallet', 'payos'], default: undefined },

    /**
     * false => giao dịch này KHÔNG đụng tới số dư ví (thanh toán PayOS trực tiếp).
     * Mặc định không đặt để bản ghi cũ không bị hiểu sai; tầng hiển thị coi
     * `walletAffected !== false` là có ảnh hưởng ví.
     */
    walletAffected: { type: Boolean, default: undefined },

    amount: { type: Number, required: true, min: 0 },

    /**
     * Ảnh chụp số dư tại thời điểm giao dịch thành công. Được ghi NGUYÊN TỬ
     * cùng lúc với việc đổi số dư (xem walletService) nên không bao giờ lệch.
     * Bản ghi lịch sử cũ có thể thiếu — tuyệt đối KHÔNG suy ngược từ số dư
     * hiện tại, thiếu thì để trống và báo cáo là thiếu.
     */
    balanceBefore: { type: Number, default: undefined },
    balanceAfter: { type: Number, default: undefined },

    description: { type: String, trim: true },
    invoiceId: { type: Types.ObjectId, ref: 'Invoice' },
    /** Chụp lại số hoá đơn để hiển thị mà không cần populate (hoá đơn có thể bị sửa). */
    invoiceNumber: { type: String, trim: true },

    paymentId: { type: String, trim: true },
    orderCode: { type: Number }, // PayOS orderCode — khoá đối soát ổn định, dùng để chống ghi trùng
    /** Mã tham chiếu PayOS trả về trong webhook (data.reference). */
    reference: { type: String, trim: true },
    paymentLinkId: { type: String, trim: true },

    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    /** Vì sao thất bại/huỷ — đã được chuẩn hoá, không chứa payload thô của nhà cung cấp. */
    failureReason: { type: String, trim: true },

    /**
     * true = dòng sổ được DỰNG LẠI từ bản ghi Payment/Invoice cũ, không phải ghi
     * tại thời điểm tiền thật sự chuyển. Những dòng này CỐ Ý không có
     * balanceBefore/balanceAfter vì dữ liệu gốc không đủ để tái dựng chính xác —
     * thà thiếu còn hơn bịa một con số sai trong sổ tài chính.
     */
    backfilled: { type: Boolean, default: undefined },

    createdAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
  },
  { _id: true },
);

const familyWalletSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    balance: { type: Number, default: 0, min: 0 },
    totalTopup: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    transactions: [walletTransactionSchema],
  },
  { timestamps: true },
);

// Đối soát theo orderCode của PayOS: webhook có thể được gửi lại nhiều lần nên
// việc tra cứu theo orderCode phải nhanh và chính xác.
familyWalletSchema.index({ 'transactions.orderCode': 1 });
familyWalletSchema.index({ 'transactions.paymentId': 1 });

module.exports = mongoose.models.FamilyWallet || mongoose.model('FamilyWallet', familyWalletSchema);

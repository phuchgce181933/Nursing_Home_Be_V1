const mongoose = require('mongoose');

const OtpSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  phone: { type: String, required: true },
  /**
   * Chỉ lưu HMAC-SHA256 của mã, KHÔNG lưu mã gốc. Mã gốc chỉ tồn tại trong bộ
   * nhớ đúng một lần lúc tạo để gửi SMS/email; sau đó không nơi nào đọc lại
   * được. Dump DB bị rò rỉ cũng không dùng được để xác thực giao dịch.
   */
  codeHash: { type: String, required: true },
  purpose: { type: String, required: true },
  meta: { type: mongoose.Schema.Types.Mixed },
  attempts: { type: Number, default: 0 },
  used: { type: Boolean, default: false },
  /** Vì sao mã bị vô hiệu: xác thực xong, bị mã mới thay thế, hoặc sai quá số lần. */
  consumedReason: { type: String, enum: ['verified', 'superseded', 'attempts_exceeded', null], default: null },
  consumedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

// TTL: tự xoá bản ghi khi quá hạn.
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Tra cứu mã còn hiệu lực theo người dùng + mục đích (dùng ở bước gửi lại).
OtpSchema.index({ userId: 1, purpose: 1, used: 1, createdAt: -1 });

module.exports = mongoose.model('Otp', OtpSchema);

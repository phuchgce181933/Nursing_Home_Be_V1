const crypto = require('crypto');
const otpRepo = require('../repositories/otpRepository');
const mailService = require('./mailService');
const { apiErr, CODES } = require('../utils/apiError');

const DEFAULT_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/** Khoảng cách tối thiểu giữa 2 lần yêu cầu mã cho cùng (người dùng, mục đích). */
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Khoá băm mã OTP. Tách riêng khỏi JWT_SECRET nếu có OTP_HASH_SECRET; nếu không
 * thì dùng JWT_SECRET để không phải thêm biến môi trường bắt buộc cho môi
 * trường local đang chạy.
 */
const hashSecret = () => process.env.OTP_HASH_SECRET || process.env.JWT_SECRET || '';

const hashCode = (code) =>
  crypto.createHmac('sha256', hashSecret()).update(String(code)).digest('hex');

/** So sánh hằng thời gian để không rò rỉ thông tin qua thời gian phản hồi. */
const hashEquals = (a, b) => {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Mã 6 chữ số bằng nguồn ngẫu nhiên an toàn mật mã (crypto.randomInt), KHÔNG
 * dùng Math.random() vì Math.random() có thể đoán trước được.
 */
const generateCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

const maskEmail = (email) =>
  email.replace(/(.{2})(.*)(@.*)/, (_, start, middle, domain) => `${start}${'*'.repeat(Math.max(3, middle.length))}${domain}`);

const maskPhone = (phone) => String(phone).replace(/.(?=.{4})/g, '*');

/**
 * Mục đích "đặt lại mật khẩu". Tách hằng số để không ai gõ sai chuỗi và để thấy
 * rõ đây là một purpose RIÊNG BIỆT: mã đặt lại mật khẩu không bao giờ dùng được
 * cho `wallet_payment`, `verify_email_change` hay `verify_phone_change`, vì
 * `verifyOtp` chặn cứng lệch purpose (OTP_PURPOSE_MISMATCH).
 */
const PURPOSE_PASSWORD_RESET = 'password_reset';

/**
 * Chọn mẫu email theo purpose — TẬP TRUNG tại đúng một chỗ. Nhờ vậy các tầng
 * khác (controller, authService) không phải rải if/else chọn template, và thêm
 * một luồng OTP qua email mới chỉ là thêm một dòng ở đây.
 * Purpose không có trong bảng thì dùng mẫu xác thực email như trước.
 */
const EMAIL_TEMPLATE_BY_PURPOSE = {
  [PURPOSE_PASSWORD_RESET]: (args) => mailService.sendMobilePasswordResetCodeEmail(args),
};

const sendEmailCode = async ({ to, code, expiresMinutes, purpose }) => {
  const send = EMAIL_TEMPLATE_BY_PURPOSE[purpose] || mailService.sendEmailVerificationOtp;
  await send({ to, code, expiresMinutes });
};

/**
 * Tạo và gửi mã OTP.
 *
 * Chính sách gửi lại: mỗi (userId, purpose) chỉ có TỐI ĐA MỘT mã còn hiệu lực.
 * Yêu cầu mới sẽ vô hiệu hoá toàn bộ mã cũ (consumedReason='superseded') rồi mới
 * phát mã mới, kèm khoảng chờ tối thiểu RESEND_COOLDOWN_SECONDS để chống spam.
 */
const createOtp = async ({ userId, phone, purpose = 'wallet_payment', meta = {}, expiresMinutes = DEFAULT_EXPIRY_MINUTES }) => {
  if (!phone) throw apiErr(CODES.OTP_PHONE_MISSING, { statusCode: 400 });

  const now = new Date();

  // Chặn spam: nếu mã gần nhất vừa được phát cách đây chưa tới cooldown thì từ chối.
  const pending = await otpRepo.findByFilter(
    { userId, purpose, used: false, expiresAt: { $gt: now } },
    { sort: { createdAt: -1 } },
  );

  const newest = pending[0];
  if (newest) {
    const elapsedSeconds = Math.floor((now - new Date(newest.createdAt)) / 1000);
    if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {
      throw apiErr(CODES.OTP_RESEND_TOO_SOON, {
        statusCode: 429,
        params: { seconds: RESEND_COOLDOWN_SECONDS - elapsedSeconds },
      });
    }
  }

  const code = generateCode();
  const expiresAt = new Date(now.getTime() + expiresMinutes * 60 * 1000);
  const otp = await otpRepo.create({
    userId,
    phone,
    codeHash: hashCode(code),
    purpose,
    meta,
    expiresAt,
  });

  try {
    if (String(phone).includes('@')) {
      await sendEmailCode({ to: phone, code, expiresMinutes, purpose });
    } else {
      await sendSmsCode({ phone, code, expiresMinutes });
    }
  } catch (err) {
    // Gửi thất bại thì thu hồi mã ngay, tránh để lại mã "treo" chặn lần gửi sau.
    await otpRepo.deleteById(otp._id).catch(() => {});
    // KHÔNG log `code`. Chỉ log thông điệp lỗi của nhà cung cấp.
    console.error('otpService.createOtp: gửi mã thất bại:', err?.message || err);
    throw apiErr(CODES.OTP_SEND_FAILED, { statusCode: 502 });
  }

  // Chỉ vô hiệu hoá mã cũ SAU KHI mã mới đã gửi thành công, để lần gửi lỗi
  // không làm người dùng mất luôn mã đang cầm trên tay.
  await otpRepo.updateMany(
    { userId, purpose, used: false, _id: { $ne: otp._id } },
    { $set: { used: true, consumedReason: 'superseded', consumedAt: now } },
  );

  return {
    otpId: otp._id,
    maskedRecipient: String(phone).includes('@') ? maskEmail(phone) : maskPhone(phone),
    expiresInSeconds: Math.round((expiresAt - now) / 1000),
    resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
  };
};

/**
 * Gửi mã qua SMS bằng nhà cung cấp THẬT (TextBee, gateway chạy trên máy Android).
 *
 * Không có kênh dự phòng nào in mã ra console, kể cả khi chạy local: mã gốc
 * tuyệt đối không xuất hiện trong log. Gửi thất bại thì ném lỗi để người dùng
 * thấy đúng sự thật, thay vì âm thầm coi như đã gửi được.
 *
 * Lưu ý: TextBee nhận request xong chỉ có nghĩa là "đã vào hàng đợi" — máy
 * Android vẫn phải online thì tin nhắn mới thực sự đi. Vì vậy phần giao diện
 * dùng câu "đã được yêu cầu gửi", không khẳng định "đã gửi thành công".
 */
const sendSmsCode = async ({ phone, code, expiresMinutes }) => {
  const message = `Ma OTP xac thuc giao dich: ${code}. Het han sau ${expiresMinutes} phut.`;
  await mailService.sendTextBeeSms({ to: phone, message });
};

/**
 * Lõi xác thực dùng chung cho mọi cách tìm ra bản ghi OTP (theo `otpId` hoặc theo
 * cặp người dùng + mục đích). Gom vào một hàm để chỉ tồn tại MỘT bản luật:
 * hết hạn -> quá số lần -> so mã hằng thời gian -> tiêu thụ nguyên tử.
 */
const consumeIfCodeMatches = async (otp, code) => {
  if (otp.used) {
    throw apiErr(
      otp.consumedReason === 'attempts_exceeded' ? CODES.OTP_TOO_MANY_ATTEMPTS : CODES.OTP_ALREADY_USED,
      { statusCode: 400 },
    );
  }
  if (otp.expiresAt && otp.expiresAt < new Date()) throw apiErr(CODES.OTP_EXPIRED, { statusCode: 400 });
  if (otp.attempts >= MAX_ATTEMPTS) throw apiErr(CODES.OTP_TOO_MANY_ATTEMPTS, { statusCode: 400 });

  if (hashEquals(otp.codeHash, hashCode(String(code).trim()))) {
    // Tiêu thụ nguyên tử: chỉ request ĐẦU TIÊN đổi được used:false -> true.
    // Nếu hai request cùng gửi một mã (bấm 2 lần / retry mạng), request thứ hai
    // nhận null ở đây và KHÔNG bao giờ chạy tới bước trừ tiền.
    const consumed = await otpRepo.consumeById(otp._id, 'verified');
    if (!consumed) throw apiErr(CODES.OTP_ALREADY_USED, { statusCode: 400 });
    return { success: true, meta: consumed.meta, otpId: String(consumed._id) };
  }

  const after = await otpRepo.incrementAttempts(otp._id);
  const attempts = after?.attempts ?? otp.attempts + 1;

  // Sai tới lần cuối cùng thì đốt luôn mã, buộc phải xin mã mới.
  if (attempts >= MAX_ATTEMPTS) {
    await otpRepo.consumeById(otp._id, 'attempts_exceeded');
    throw apiErr(CODES.OTP_TOO_MANY_ATTEMPTS, { statusCode: 400 });
  }

  throw apiErr(CODES.OTP_INVALID, {
    statusCode: 400,
    params: { remaining: MAX_ATTEMPTS - attempts },
  });
};

/**
 * Xác thực mã khi client ĐANG GIỮ `otpId` (luồng có màn hình chờ: ví, đổi email,
 * đổi số điện thoại). Mã dùng một lần: xác thực đúng là đánh dấu đã dùng ngay, nên
 * không thể phát lại cho giao dịch khác. `meta` trả về là dữ liệu đã được chốt
 * lúc tạo mã (hoá đơn + số tiền), nên mã cũ không thể dùng cho hoá đơn khác.
 */
const verifyOtp = async ({ userId, otpId, code, purpose = 'wallet_payment' }) => {
  let otp = null;
  try {
    otp = await otpRepo.findById(otpId);
  } catch {
    otp = null; // otpId sai định dạng ObjectId
  }
  if (!otp) throw apiErr(CODES.OTP_NOT_FOUND, { statusCode: 400 });
  if (userId && otp.userId && String(otp.userId) !== String(userId)) {
    throw apiErr(CODES.OTP_FORBIDDEN, { statusCode: 403 });
  }
  if (otp.purpose !== purpose) throw apiErr(CODES.OTP_PURPOSE_MISMATCH, { statusCode: 400 });
  return consumeIfCodeMatches(otp, code);
};

/**
 * Xác thực mã khi client KHÔNG có `otpId` — trường hợp đặt lại mật khẩu: người
 * dùng chưa đăng nhập, rời app sang hộp thư rồi quay lại, và endpoint quên mật
 * khẩu CỐ TÌNH không trả `otpId` (trả về sẽ tiết lộ email có tồn tại hay không).
 *
 * Vì `createOtp` bảo đảm mỗi (userId, purpose) chỉ có TỐI ĐA MỘT mã còn hiệu lực
 * (mã cũ bị đánh 'superseded'), lấy bản ghi chưa dùng mới nhất là không nhập nhằng.
 * Mã vẫn buộc theo đúng người dùng và đúng mục đích qua chính filter này.
 */
const verifyOtpByUser = async ({ userId, code, purpose }) => {
  const [otp] = await otpRepo.findByFilter(
    { userId, purpose, used: false },
    { sort: { createdAt: -1 } },
  );
  // Không có mã nào đang chờ -> trả OTP_INVALID y như khi nhập sai mã, để không
  // phân biệt được "email này chưa từng xin đặt lại" với "mã nhập sai".
  if (!otp) throw apiErr(CODES.OTP_INVALID, { statusCode: 400 });
  return consumeIfCodeMatches(otp, code);
};

/**
 * Vô hiệu hoá mọi mã còn hiệu lực của một (người dùng, mục đích). Dùng sau khi
 * đặt lại mật khẩu xong: mã chưa dùng còn sót lại phải chết theo, kể cả mã được
 * phát cho client khác.
 */
const invalidateActiveOtps = async ({ userId, purpose, reason = 'superseded' }) => {
  if (!userId || !purpose) return;
  await otpRepo.updateMany(
    { userId, purpose, used: false },
    { $set: { used: true, consumedReason: reason, consumedAt: new Date() } },
  );
};

module.exports = {
  createOtp,
  verifyOtp,
  verifyOtpByUser,
  invalidateActiveOtps,
  PURPOSE_PASSWORD_RESET,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  DEFAULT_EXPIRY_MINUTES,
};

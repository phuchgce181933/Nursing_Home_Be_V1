const Otp = require('../models/otp');
const mailService = require('./mailService');
const ServiceError = require('./serviceError');

const DEFAULT_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const createOtp = async ({ userId, phone, purpose = 'wallet_payment', meta = {}, expiresMinutes = DEFAULT_EXPIRY_MINUTES }) => {
  const now = new Date();
  const existingPendingOtps = await Otp.find({
    userId,
    purpose,
    used: false,
    expiresAt: { $gt: now },
  }).sort({ createdAt: -1 });

  if (existingPendingOtps.length > 1) {
    throw new ServiceError('Bạn đã gửi mã OTP quá 1 lần. Vui lòng nhập mã OTP hiện tại hoặc đợi 10 phút mã hết hạn trước khi yêu cầu lại.', 429);
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);
  
  const otp = await Otp.create({ userId, phone, code, purpose, meta, expiresAt });
  
  try {
    if (phone.includes('@')) {
      const masked = phone.replace(/(.{2})(.*)(@.*)/, (_, start, middle, domain) => `${start}${'*'.repeat(Math.max(3, middle.length))}${domain}`);
      await mailService.sendEmailVerificationOtp({ to: phone, code, expiresMinutes });
      return { otpId: otp._id, maskedRecipient: masked };
    }

    const masked = phone.replace(/.(?=.{4})/g, '*');
    const isLocalDev = process.env.NODE_ENV === 'local';

    const message = `Mã OTP để xác thực giao dịch: ${code}. Hết hạn trong ${expiresMinutes} phút.`;
    if (isLocalDev) {
      console.log(`Local dev attempting SMS via TextBee to ${phone} with code ${code}`);
    }

    try {
      await mailService.sendTextBeeSms({ to: phone, message });
      return { otpId: otp._id, maskedRecipient: masked };
    } catch (err) {
      if (isLocalDev) {
        console.log(`DEV OTP fallback for ${phone}: ${code} (expires in ${expiresMinutes} minutes)`);
        return { otpId: otp._id, maskedRecipient: masked };
      }
      throw err;
    }
  } catch (err) {
    // If SMS fails, remove OTP
    await Otp.deleteOne({ _id: otp._id }).catch(() => {});
    console.error('otpService.createOtp send error:', err);
    const msg = err?.message || 'Failed to send OTP SMS';
    throw new ServiceError(msg, 500);
  }
};

const verifyOtp = async ({ userId, otpId, code, purpose = 'wallet_payment' }) => {
  const otp = await Otp.findById(otpId);
  if (!otp) throw new ServiceError('OTP not found or expired', 400);
  if (String(otp.userId) !== String(userId)) throw new ServiceError('OTP does not belong to user', 403);
  if (otp.purpose !== purpose) throw new ServiceError('OTP purpose mismatch', 400);
  if (otp.used) throw new ServiceError('OTP already used', 400);
  if (otp.attempts >= MAX_ATTEMPTS) throw new ServiceError('Too many attempts', 400);
  if (otp.expiresAt && otp.expiresAt < new Date()) throw new ServiceError('OTP expired', 400);

  otp.attempts += 1;
  const ok = otp.code === String(code).trim();
  if (ok) {
    otp.used = true;
    await otp.save();
    return { success: true, meta: otp.meta };
  }

  await otp.save();
  throw new ServiceError('Invalid OTP code', 400);
};

module.exports = { createOtp, verifyOtp };

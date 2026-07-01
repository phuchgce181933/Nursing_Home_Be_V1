const Otp = require('../models/otp');
const mailService = require('./mailService');
const ServiceError = require('./serviceError');

const DEFAULT_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const createOtp = async ({ userId, phone, purpose = 'wallet_payment', meta = {}, expiresMinutes = DEFAULT_EXPIRY_MINUTES }) => {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

  const otp = await Otp.create({ userId, phone, code, purpose, meta, expiresAt });

  // Send SMS via existing TextBee wrapper
  try {
    const masked = phone.replace(/.(?=.{4})/g, '*');
    const message = `Mã OTP để xác thực giao dịch: ${code}. Hết hạn trong ${expiresMinutes} phút.`;
    await mailService.sendTextBeeSms({ to: phone, message });
    return { otpId: otp._id, maskedPhone: masked };
  } catch (err) {
    // If SMS fails, remove OTP
    await Otp.deleteOne({ _id: otp._id }).catch(() => {});
    throw new ServiceError('Failed to send OTP SMS', 500);
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

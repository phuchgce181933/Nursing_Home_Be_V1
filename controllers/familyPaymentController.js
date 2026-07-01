const otpService = require('../services/otpService');
const walletService = require('../services/walletService');
const paymentService = require('../services/paymentService');
const ServiceError = require('../services/serviceError');

// POST /api/family/wallet/payments/initiate
const initiateWalletPayment = async (req, res, next) => {
  try {
    const { amount, invoiceIds } = req.body;
    if (!amount || amount <= 0) throw new ServiceError('Invalid amount', 400);
    // store payment intent in meta so verify step can perform the payment
    const meta = { amount, invoiceIds };
    const phone = req.user.phoneNumber || req.user.phone || '';
    if (!phone) throw new ServiceError('User has no phone number', 400);

    const result = await otpService.createOtp({ userId: req.user._id, phone, purpose: 'wallet_payment', meta });
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
};

// POST /api/family/wallet/payments/verify
const verifyWalletPayment = async (req, res, next) => {
  try {
    const { otpId, code } = req.body;
    if (!otpId || !code) throw new ServiceError('otpId and code required', 400);

    const { meta } = await otpService.verifyOtp({ userId: req.user._id, otpId, code, purpose: 'wallet_payment' });

    // meta contains amount and invoiceIds (optional)
    const amount = Number(meta.amount) || 0;
    if (amount <= 0) throw new ServiceError('Invalid payment amount in OTP meta', 400);

    // If invoiceIds provided and single invoice, call recordPayment logic
    if (Array.isArray(meta.invoiceIds) && meta.invoiceIds.length > 0) {
      // For simplicity, if more than 1 invoice, call batchPayment service
      if (meta.invoiceIds.length === 1) {
        const invoiceId = meta.invoiceIds[0];
        // Deduct wallet then record payment similarly to paymentController.recordPayment
        await walletService.deductFromWallet(req.user._id, amount, `Thanh toán hóa đơn ${invoiceId}`, invoiceId);
        const payment = await paymentService.recordPayment(req.user, invoiceId, { paymentMethod: 'wallet', amount });
        return res.status(201).json({ success: true, data: payment });
      }

      // multiple invoices
      const result = await paymentService.batchPayment(req.user, null, meta.invoiceIds, { paymentMethod: 'wallet', amount }, req);
      return res.status(201).json({ success: true, data: result });
    }

    // No invoices specified — use a generic wallet deduction (e.g., for topups or other payments)
    await walletService.deductFromWallet(req.user._id, amount, `Thanh toán bằng ví (OTP)`, null);
    return res.json({ success: true, data: { message: 'Payment completed' } });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  initiateWalletPayment,
  verifyWalletPayment,
};

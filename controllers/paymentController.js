const paymentService = require('../services/paymentService');
const walletService = require('../services/walletService');
const ServiceError = require('../services/serviceError');
const { apiErr, CODES } = require('../utils/apiError');

/**
 * Người nhà chỉ được trừ ví qua luồng có xác thực OTP
 * (`/api/family/wallet/payments/initiate` + `/verify`). Hai endpoint ghi nhận
 * thanh toán dưới đây vẫn dành cho nhân viên ghi nhận tiền mặt/chuyển khoản và
 * cho PayOS, nên chỉ chặn đúng trường hợp `family` + `wallet`.
 */
const assertWalletPaymentNeedsOtp = (user, paymentMethod) => {
  if (paymentMethod === 'wallet' && user?.role === 'family') {
    throw apiErr(CODES.WALLET_PAYMENT_OTP_REQUIRED, { statusCode: 403 });
  }
};

const createInvoice = async (req, res, next) => {
  try {
    const invoice = await paymentService.createInvoice(req.user, req.params.residentId, req.body, req);
    return res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    return next(error);
  }
};

const getInvoice = async (req, res, next) => {
  try {
    const invoice = await paymentService.findInvoiceById(req.user, req.params.invoiceId);
    return res.json({ success: true, data: invoice });
  } catch (error) {
    return next(error);
  }
};

const getPayosCheckoutPage = async (req, res, next) => {
  try {
    const invoice = await paymentService.findInvoiceForCheckout(req.user, req.params.residentId, req.params.invoiceId, req.query);
    const payosData = await paymentService.createPayosPaymentRequest({ invoice, req });
    if (payosData.orderCode) {
      await paymentService.storeInvoicePayosOrderCode(invoice._id, payosData.orderCode);
    }

    if (payosData.checkoutUrl) {
      return res.redirect(payosData.checkoutUrl);
    }

    const fallbackUrl = payosData.qrCode ? '' : '';
    return res.send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PayOS Checkout</title>
    <style>
      body {font-family: Arial, sans-serif; background: #f4f6fb; color: #1f2937; margin: 0; padding: 0;}
      .container {max-width: 560px; margin: 60px auto; padding: 24px; background: #fff; border-radius: 12px; box-shadow: 0 22px 50px rgba(15, 23, 42, .08);}
      h1 {font-size: 24px; margin-bottom: 8px;}
      p {line-height: 1.6;}
      .details {margin: 20px 0; padding: 18px; background: #eef2ff; border-radius: 10px;}
      .button {display: inline-block; padding: 12px 20px; background: #2563eb; color: white; border-radius: 8px; text-decoration: none;}
      .hint {font-size: 14px; color: #6b7280; margin-top: 12px;}
      .code {word-break: break-all; background: #f8fafc; padding: 16px; border-radius: 10px; border: 1px solid #d1d5db;}
    </style>
  </head>
  <body>
    <div class="container">
      <h1>PayOS Checkout</h1>
      <p>Your payment request was created successfully.</p>
      <div class="details">
        <p><strong>Invoice:</strong> ${invoice.invoiceNumber}</p>
        <p><strong>Total:</strong> ${invoice.totalAmount.toFixed(2)}</p>
        <p><strong>Status:</strong> ${invoice.status}</p>
      </div>
      ${payosData.checkoutUrl ? `<a class="button" href="${payosData.checkoutUrl}">Continue to PayOS</a>` : ''}
      ${payosData.qrCode ? `<p class="hint">QR payload:</p><div class="code">${payosData.qrCode}</div>` : ''}
      <p class="hint">If the redirect did not happen automatically, click the button above.</p>
    </div>
  </body>
</html>`);
  } catch (error) {
    return next(error);
  }
};

const recordPayment = async (req, res, next) => {
  const { paymentMethod, amount: requestedAmount, note } = req.body;
  const walletPayment = paymentMethod === 'wallet';
  let deductedFromWallet = false;

  try {
    assertWalletPaymentNeedsOtp(req.user, paymentMethod);

    const invoice = await paymentService.findInvoiceById(req.user, req.params.invoiceId);
    const amount = Number(requestedAmount != null ? requestedAmount : invoice.totalAmount) || 0;
    if (amount <= 0) {
      throw new ServiceError('Số tiền thanh toán phải lớn hơn 0', 400);
    }

    if (walletPayment) {
      await walletService.deductFromWallet(
        req.user._id,
        amount,
        `Thanh toán hóa đơn ${invoice.invoiceNumber}`,
        req.params.invoiceId,
      );
      deductedFromWallet = true;
    }

    const payment = await paymentService.recordPayment(req.user, req.params.invoiceId, {
      ...req.body,
      amount,
    });

    return res.status(201).json({ success: true, data: payment });
  } catch (error) {
    if (walletPayment && deductedFromWallet) {
      try {
        const refundAmount = Number(requestedAmount != null ? requestedAmount : 0) || 0;
        if (refundAmount > 0) {
          await walletService.refundToWallet(
            req.user._id,
            refundAmount,
            `Hoàn tiền do lỗi thanh toán hóa đơn ${req.params.invoiceId}`,
            req.params.invoiceId,
          );
        }
      } catch (refundError) {
        console.error('Failed to refund wallet after payment error:', refundError);
      }
    }
    return next(error);
  }
};

const listInvoices = async (req, res, next) => {
  try {
    const { residentId } = req.params;
    const invoices = await paymentService.listInvoicesByResident(req.user, residentId);
    return res.json({ success: true, data: invoices });
  } catch (error) {
    return next(error);
  }
};

const batchPayment = async (req, res, next) => {
  const { paymentMethod, amount: requestedAmount, note, invoiceIds } = req.body;
  const walletPayment = paymentMethod === 'wallet';
  let deductedFromWallet = false;

  try {
    assertWalletPaymentNeedsOtp(req.user, paymentMethod);

    // Calculate total amount for validation
    let totalAmount = 0;
    for (const invoiceId of invoiceIds) {
      const invoice = await paymentService.findInvoiceById(req.user, invoiceId);
      totalAmount += invoice.totalAmount || 0;
    }

    const amount = Number(requestedAmount != null ? requestedAmount : totalAmount) || 0;
    if (amount <= 0) {
      throw new ServiceError('Số tiền thanh toán phải lớn hơn 0', 400);
    }

    if (walletPayment) {
      await walletService.deductFromWallet(
        req.user._id,
        amount,
        `Thanh toán hóa đơn theo gói (${invoiceIds.length} hóa đơn)`,
        invoiceIds[0], // First invoice as reference
      );
      deductedFromWallet = true;
    }

    const result = await paymentService.batchPayment(req.user, req.params.residentId, invoiceIds, {
      ...req.body,
      amount,
    }, req);

    // If PayOS, return checkout URL
    if (result.checkoutUrl) {
      return res.status(200).json({ success: true, data: result });
    }

    // If wallet/other payment, return payment records
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (walletPayment && deductedFromWallet) {
      try {
        const refundAmount = Number(requestedAmount != null ? requestedAmount : 0) || 0;
        if (refundAmount > 0) {
          await walletService.refundToWallet(
            req.user._id,
            refundAmount,
            `Hoàn tiền do lỗi thanh toán hóa đơn theo gói`,
            req.body.invoiceIds[0],
          );
        }
      } catch (refundError) {
        console.error('Failed to refund wallet after batch payment error:', refundError);
      }
    }
    return next(error);
  }
};

module.exports = {
  createInvoice,
  getInvoice,
  getPayosCheckoutPage,
  recordPayment,
  listInvoices,
  batchPayment,
};

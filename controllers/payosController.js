const crypto = require('crypto');
const invoiceRepo = require('../repositories/invoiceRepository');
const walletService = require('../services/walletService');
const paymentService = require('../services/paymentService');

const getChecksumKey = () =>
  process.env.PAYOS_CHECKSUM_KEY || '2928b277a4b208bd9725946d9b5098013948863a43931e59ce5da5765dabccee';

// PayOS webhook signature: HMAC-SHA256 over sorted key=value pairs of the data object
const verifyWebhookSignature = (data, signature) => {
  if (!data || !signature) return false;
  const sortedString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('&');
  const expected = crypto.createHmac('sha256', getChecksumKey()).update(sortedString, 'utf8').digest('hex');
  return expected === signature;
};

const TOPUP_DESCRIPTION_PREFIX = 'Thanh toan hoa don TOPUP';

const handleWebhook = async (req, res, next) => {
  try {
    const body = req.body && Object.keys(req.body).length ? req.body : {};

    console.log('[PayOS Webhook] Received:', JSON.stringify({ code: body.code, desc: body.desc, hasData: !!body.data }));

    const { code, data, signature } = body;

    // Always ack 200 so PayOS stops retrying, even on processing errors
    if (!data) {
      return res.status(200).json({ success: true });
    }

    // Verify signature
    if (!verifyWebhookSignature(data, signature)) {
      console.warn('[PayOS Webhook] Invalid signature — ignoring');
      return res.status(200).json({ success: true });
    }

    // Only process confirmed payments
    if (code !== '00' || data.code !== '00') {
      console.log('[PayOS Webhook] Non-success code, skipping:', code);
      return res.status(200).json({ success: true });
    }

    const amount = Number(data.amount);
    const description = String(data.description || '');
    const reference = String(data.reference || data.transactionDateTime || Date.now());

    if (description.includes('TOPUP') || description.startsWith(TOPUP_DESCRIPTION_PREFIX.slice(0, 20))) {
      // Wallet top-up payment
      try {
        await walletService.confirmPendingTopupByAmount(amount, reference);
        console.log('[PayOS Webhook] Topup confirmed for amount:', amount);
      } catch (err) {
        console.warn('[PayOS Webhook] Could not confirm topup:', err.message);
      }
    } else {
      // Invoice payment — try to match via orderCode or invoiceId embedded in description
      // invoiceId is not in the data object, but we log for debugging
      console.log('[PayOS Webhook] Invoice payment received — orderCode:', data.orderCode, 'amount:', amount);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[PayOS Webhook] Error:', error);
    // Always return 200 to prevent PayOS from retrying
    return res.status(200).json({ success: true });
  }
};

const handleReturn = async (req, res, next) => {
  try {
    const { invoiceId, status } = req.query;

    if (invoiceId && String(invoiceId).startsWith('topup_') && status === 'PAID') {
      try {
        const parts = String(invoiceId).split('_');
        const userId = parts[1];
        await walletService.confirmTopup(userId, String(invoiceId), String(invoiceId));
        console.log('[PayOS Return] Topup confirmed via return URL:', invoiceId);
      } catch (err) {
        console.warn('[PayOS Return] Unable to confirm wallet topup:', err.message);
      }
    } else if (status === 'PAID' && invoiceId && !String(invoiceId).startsWith('topup_')) {
      try {
        await paymentService.markInvoiceAsPaid(invoiceId);
        console.log('[PayOS Return] Invoice marked paid:', invoiceId);
      } catch (err) {
        console.warn('[PayOS Return] Unable to mark invoice paid:', err.message || err);
      }
    }

    // Return a user-friendly page instead of redirecting to web admin
    const paymentStatus = status === 'PAID' ? 'thành công' : 'không thành công';
    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Kết quả thanh toán</title>
        <style>
          body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f0fdf4; }
          .card { background: #fff; border-radius: 12px; padding: 40px 32px; text-align: center; max-width: 360px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
          h2 { color: ${status === 'PAID' ? '#16a34a' : '#dc2626'}; margin-bottom: 12px; }
          p { color: #6b7280; margin: 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>${status === 'PAID' ? '✓ Thanh toán thành công' : '✗ Thanh toán thất bại'}</h2>
          <p>Giao dịch ${paymentStatus}. Vui lòng quay lại ứng dụng để xem số dư ví.</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    return next(error);
  }
};

const handleCancel = async (req, res, next) => {
  try {
    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Huỷ thanh toán</title>
        <style>
          body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fef2f2; }
          .card { background: #fff; border-radius: 12px; padding: 40px 32px; text-align: center; max-width: 360px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
          h2 { color: #dc2626; margin-bottom: 12px; }
          p { color: #6b7280; margin: 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>✗ Đã huỷ thanh toán</h2>
          <p>Bạn đã huỷ giao dịch. Vui lòng quay lại ứng dụng.</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  handleWebhook,
  handleReturn,
  handleCancel,
};

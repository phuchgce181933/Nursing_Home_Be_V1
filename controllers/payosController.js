const crypto = require('crypto');
const invoiceRepo = require('../repositories/invoiceRepository');
const walletService = require('../services/walletService');
const paymentService = require('../services/paymentService');

// No hardcoded fallback on purpose — see services/paymentService.js:getPayosCredentials for why.
const getChecksumKey = () => {
  if (!process.env.PAYOS_CHECKSUM_KEY) {
    throw new Error('PAYOS_CHECKSUM_KEY is not configured');
  }
  return process.env.PAYOS_CHECKSUM_KEY;
};

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
    } else if (data.orderCode) {
      // Invoice payment — match against the orderCode we persisted when the checkout was created.
      try {
        const paidInvoices = await paymentService.confirmInvoicesByOrderCode(data.orderCode);
        console.log('[PayOS Webhook] Invoices confirmed paid via orderCode:', data.orderCode, paidInvoices.length);
      } catch (err) {
        console.warn('[PayOS Webhook] Could not confirm invoice by orderCode:', err.message);
      }
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
    const { invoiceId } = req.query;
    // The return-URL query string is set by the user's browser redirect and is not signed —
    // it must never be trusted on its own. Always re-verify the real status with PayOS
    // (server-to-server) before crediting a wallet or marking an invoice paid.
    let verifiedPaid = false;

    if (invoiceId && String(invoiceId).startsWith('topup_')) {
      try {
        const parts = String(invoiceId).split('_');
        const userId = parts[1];
        const result = await walletService.verifyAndConfirmTopup(userId, String(invoiceId));
        verifiedPaid = result.status === 'PAID';
        console.log('[PayOS Return] Topup verification result:', invoiceId, result.status);
      } catch (err) {
        console.warn('[PayOS Return] Unable to verify wallet topup:', err.message);
      }
    } else if (invoiceId) {
      try {
        // Handle batch invoiceIds (comma-separated)
        const invoiceIds = String(invoiceId).includes(',')
          ? String(invoiceId).split(',').map(id => id.trim())
          : [String(invoiceId)];

        const results = await Promise.all(invoiceIds.map(async (id) => {
          try {
            const result = await paymentService.verifyAndMarkInvoicePaid(id);
            console.log('[PayOS Return] Invoice verification result:', id, result.status);
            return result.status === 'PAID';
          } catch (err) {
            console.warn('[PayOS Return] Unable to verify invoice:', id, err.message || err);
            return false;
          }
        }));
        verifiedPaid = results.length > 0 && results.every(Boolean);
      } catch (err) {
        console.warn('[PayOS Return] Unable to process invoices:', err.message || err);
      }
    }

    // The page only reflects what was actually verified with PayOS, never the raw query string.
    const status = verifiedPaid ? 'PAID' : 'PENDING';
    const paymentStatus = verifiedPaid ? 'thành công' : 'đang được xử lý hoặc chưa xác nhận';
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

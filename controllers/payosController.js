const invoiceRepo = require('../repositories/invoiceRepository');
const walletService = require('../services/walletService');
const paymentService = require('../services/paymentService');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const ADMIN_DASHBOARD_URL = `${FRONTEND_URL.replace(/\/$/, '')}/admin/dashboard`;

const handleWebhook = async (req, res, next) => {
  try {
    const payload = req.body && Object.keys(req.body).length ? req.body : req.text || req.body;

    console.log('PayOS webhook received:', {
      headers: req.headers,
      body: payload,
    });

    // TODO: verify PayOS webhook signature or secret if required by your PayOS configuration.
    // TODO: map PayOS payload to invoice/payment records and update your database.

    return res.status(200).json({ success: true, message: 'Webhook received' });
  } catch (error) {
    return next(error);
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
      } catch (err) {
        console.warn('PayOS return: unable to confirm wallet topup', err.message || err);
      }
    } else if (status === 'PAID' && invoiceId) {
      try {
        await paymentService.markInvoiceAsPaid(invoiceId);
      } catch (err) {
        console.warn('PayOS return: unable to mark invoice paid', err.message || err);
      }
    }

    return res.redirect(ADMIN_DASHBOARD_URL);
  } catch (error) {
    return next(error);
  }
};

const handleCancel = async (req, res, next) => {
  try {
    return res.redirect(`${ADMIN_DASHBOARD_URL}?paymentCancelled=true`);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  handleWebhook,
  handleReturn,
  handleCancel,
};

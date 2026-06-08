const invoiceRepo = require('../repositories/invoiceRepository');

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

    if (status === 'PAID' && invoiceId) {
      try {
        await invoiceRepo.updateById(invoiceId, { status: 'paid' });
      } catch (err) {
        console.warn('PayOS return: unable to update invoice status', err.message || err);
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

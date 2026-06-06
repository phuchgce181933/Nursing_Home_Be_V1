const paymentService = require('../services/paymentService');
const ServiceError = require('../services/serviceError');

const createInvoice = async (req, res, next) => {
  try {
    const invoice = await paymentService.createInvoice(req.user, req.params.residentId, req.body);
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
  try {
    const payment = await paymentService.recordPayment(req.user, req.params.invoiceId, req.body);
    return res.status(201).json({ success: true, data: payment });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createInvoice,
  getInvoice,
  getPayosCheckoutPage,
  recordPayment,
};

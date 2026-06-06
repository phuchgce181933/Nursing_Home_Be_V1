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

module.exports = {
  handleWebhook,
};

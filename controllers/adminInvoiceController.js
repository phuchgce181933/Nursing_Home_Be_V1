const paymentService = require('../services/paymentService');

const listInvoices = async (req, res) => {
  try {
    const result = await paymentService.adminListInvoices(req.query);
    return res.json(result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getInvoice = async (req, res) => {
  try {
    const invoice = await paymentService.adminGetInvoice(req.params.invoiceId);
    return res.json({ success: true, data: invoice });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  listInvoices,
  getInvoice,
};

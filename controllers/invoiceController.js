const invoiceService = require('../services/invoiceService');
const { sendApiError } = require('../utils/apiErrorResponse');

const listInvoices = async (req, res) => {
  try {
    const data = await invoiceService.listInvoices(req.query || {});
    return res.json({ success: true, data });
  } catch (err) {
    return sendApiError(res, err);
  }
};

const getInvoice = async (req, res) => {
  try {
    const data = await invoiceService.getInvoice(req.params.id);
    return res.json({ success: true, data });
  } catch (err) {
    return sendApiError(res, err);
  }
};

const createMonthlyInvoice = async (req, res) => {
  try {
    const data = await invoiceService.createMonthlyInvoice(req.body, req);
    return res.json({ success: true, data });
  } catch (err) {
    return sendApiError(res, err);
  }
};

const markPaid = async (req, res) => {
  try {
    const data = await invoiceService.markPaid(req.params.id, req);
    return res.json({ success: true, data });
  } catch (err) {
    return sendApiError(res, err);
  }
};

module.exports = { listInvoices, getInvoice, createMonthlyInvoice, markPaid };

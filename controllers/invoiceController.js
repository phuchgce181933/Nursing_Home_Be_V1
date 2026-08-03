const Invoice = require('../models/invoice');
const MedicalCharge = require('../models/medicalCharge');
const paymentService = require('../services/paymentService');
const { Types } = require('mongoose');
const { runWithOptionalTransaction } = require('../utils/transaction');
const { sendApiError } = require('../utils/apiErrorResponse');

const listInvoices = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    if (q.residentId) filter.residentId = q.residentId;
    const data = await Invoice.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    return res.json({ success: true, data });
  } catch (err) {
    return sendApiError(res, err);
  }
};

const getInvoice = async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id).lean();
    if (!inv) return res.status(404).json({ message: 'Không tìm thấy hóa đơn' });
    return res.json({ success: true, data: inv });
  } catch (err) {
    return sendApiError(res, err);
  }
};

// aggregate charges in a period into a draft invoice
const createMonthlyInvoice = async (req, res) => {
  try {
    const { residentId, periodStart, periodEnd } = req.body;
    if (!residentId || !periodStart || !periodEnd) return res.status(400).json({ message: 'residentId, periodStart và periodEnd là bắt buộc' });
    const from = new Date(periodStart);
    const to = new Date(periodEnd);

    const inv = await runWithOptionalTransaction(async (session) => {
      const dbOpts = session ? { session } : {};
      const charges = await MedicalCharge.find(
        { residentId: new Types.ObjectId(residentId), performedAt: { $gte: from, $lte: to }, billingStatus: 'PENDING' },
        null,
        dbOpts
      ).lean();
      const items = charges.map(c => ({ chargeId: c._id, description: c.serviceName, amount: c.totalPrice || 0, category: c.category }));
      const invoice = new Invoice({ residentId: new Types.ObjectId(residentId), periodStart: from, periodEnd: to, items, status: 'ISSUED' });
      await invoice.save(dbOpts);
      // mark charges as BILLED and attach invoiceId
      if (charges.length) {
        await MedicalCharge.updateMany(
          { _id: { $in: charges.map(c => c._id) } },
          { $set: { billingStatus: 'BILLED', invoiceId: invoice._id } },
          dbOpts
        );
      }
      return invoice;
    });

    return res.json({ success: true, data: inv });
  } catch (err) {
    return sendApiError(res, err);
  }
};

const markPaid = async (req, res) => {
  try {
    const inv = await paymentService.markInvoiceAsPaid(req.params.id);
    return res.json({ success: true, data: inv });
  } catch (err) {
    return sendApiError(res, err);
  }
};

module.exports = { listInvoices, getInvoice, createMonthlyInvoice, markPaid };

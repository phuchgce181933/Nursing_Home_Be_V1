const Invoice = require('../models/invoice');
const MedicalCharge = require('../models/medicalCharge');
const paymentService = require('../services/paymentService');
const { Types } = require('mongoose');

const listInvoices = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    if (q.residentId) filter.residentId = q.residentId;
    const data = await Invoice.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getInvoice = async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id).lean();
    if (!inv) return res.status(404).json({ message: 'Invoice not found' });
    return res.json({ success: true, data: inv });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// aggregate charges in a period into a draft invoice
const createMonthlyInvoice = async (req, res) => {
  try {
    const { residentId, periodStart, periodEnd } = req.body;
    if (!residentId || !periodStart || !periodEnd) return res.status(400).json({ message: 'residentId, periodStart and periodEnd required' });
    const from = new Date(periodStart);
    const to = new Date(periodEnd);
    const charges = await MedicalCharge.find({ residentId: Types.ObjectId(residentId), performedAt: { $gte: from, $lte: to }, billingStatus: 'PENDING' }).lean();
    const items = charges.map(c => ({ chargeId: c._id, description: c.serviceName, amount: c.totalPrice || 0, category: c.category }));
    const inv = new Invoice({ residentId: Types.ObjectId(residentId), periodStart: from, periodEnd: to, items, status: 'ISSUED' });
    await inv.save();
    // mark charges as BILLED and attach invoiceId
    await MedicalCharge.updateMany({ _id: { $in: charges.map(c => c._id) } }, { $set: { billingStatus: 'BILLED', invoiceId: inv._id } });
    return res.json({ success: true, data: inv });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const markPaid = async (req, res) => {
  try {
    const inv = await paymentService.markInvoiceAsPaid(req.params.id);
    return res.json({ success: true, data: inv });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
};

module.exports = { listInvoices, getInvoice, createMonthlyInvoice, markPaid };

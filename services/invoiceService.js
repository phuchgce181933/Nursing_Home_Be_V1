const { Types } = require('mongoose');
const ServiceError = require('./serviceError');
const invoiceRepo = require('../repositories/invoiceRepository');
const paymentService = require('./paymentService');
const { runWithOptionalTransaction } = require('../utils/transaction');
const { createAuditLog } = require('../utils/auditLog');

const Invoice = require('../models/invoice');
const MedicalCharge = require('../models/medicalCharge');

const listInvoices = async (query) => {
  const filter = {};
  if (query.residentId) filter.residentId = query.residentId;
  return invoiceRepo.findByFilterLean(filter, { sort: { createdAt: -1 }, limit: 200 });
};

const getInvoice = async (id) => {
  const inv = await invoiceRepo.findByIdLean(id);
  if (!inv) throw new ServiceError('Không tìm thấy hóa đơn', 404);
  return inv;
};

const createMonthlyInvoice = async ({ residentId, periodStart, periodEnd }, req) => {
  if (!residentId || !periodStart || !periodEnd) {
    throw new ServiceError('residentId, periodStart và periodEnd là bắt buộc', 400);
  }
  const from = new Date(periodStart);
  const to = new Date(periodEnd);

  return runWithOptionalTransaction(async (session) => {
    const dbOpts = session ? { session } : {};
    const charges = await MedicalCharge.find(
      { residentId: new Types.ObjectId(residentId), performedAt: { $gte: from, $lte: to }, billingStatus: 'PENDING' },
      null,
      dbOpts
    ).lean();

    const items = charges.map((c) => ({
      chargeId: c._id,
      description: c.serviceName,
      amount: c.totalPrice || 0,
      category: c.category,
    }));

    const invoice = new Invoice({
      residentId: new Types.ObjectId(residentId),
      periodStart: from,
      periodEnd: to,
      items,
      status: 'ISSUED',
    });
    await invoice.save(dbOpts);

    await createAuditLog({
      actorUserId: req?.user?._id,
      actorRole: req?.user?.role,
      action: 'CREATE_MONTHLY_INVOICE',
      displayAction: 'Tạo hóa đơn hàng tháng',
      module: 'billing',
      businessModule: 'billing',
      targetEntityType: 'Invoice',
      targetEntityId: invoice._id,
      performedBy: req?.user?.fullName,
      description: `Tạo hóa đơn tháng cho cư dân ${residentId} (kỳ: ${periodStart} - ${periodEnd})`,
      afterData: { residentId, periodStart: from, periodEnd: to, itemCount: items.length, totalAmount: items.reduce((s, i) => s + (i.amount || 0), 0) },
      req,
    });

    if (charges.length) {
      await MedicalCharge.updateMany(
        { _id: { $in: charges.map((c) => c._id) } },
        { $set: { billingStatus: 'BILLED', invoiceId: invoice._id } },
        dbOpts
      );
    }

    return invoice;
  });
};

const markPaid = async (id, req) => {
  const invoice = await paymentService.markInvoiceAsPaid(id);

  await createAuditLog({
    actorUserId: req?.user?._id,
    actorRole: req?.user?.role,
    action: 'MARK_INVOICE_PAID',
    displayAction: 'Đánh dấu hóa đơn đã thanh toán',
    module: 'billing',
    businessModule: 'billing',
    targetEntityType: 'Invoice',
    targetEntityId: invoice._id,
    performedBy: req?.user?.fullName,
    description: `Đánh dấu hóa đơn đã thanh toán`,
    beforeData: { status: 'ISSUED' },
    afterData: { status: invoice.status },
    req,
  });

  return invoice;
};

module.exports = { listInvoices, getInvoice, createMonthlyInvoice, markPaid };

const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');
const { Types } = require('mongoose');
const ServiceError = require('./serviceError');
const invoiceRepo = require('../repositories/invoiceRepository');
const paymentRepo = require('../repositories/paymentRepository');
const residentRepo = require('../repositories/residentRepository');
const familyPortalRepo = require('../repositories/familyPortalRepository');
const servicePackageRepo = require('../repositories/servicePackageRepository');
const medicationStockRepo = require('../repositories/medicationStockRepository');
const MedicalCharge = require('../models/medicalCharge');
const Admission = require('../models/admission');
const Prescription = require('../models/prescription');
const { createAuditLog } = require('../utils/auditLog');

const buildInvoiceNumber = () => `INV-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 9000) + 1000}`;

const buildDefaultBillingPeriod = () => {
  const start = new Date();
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
};

const normalizeCost = (value) => {
  if (value === undefined || value === null || value === '') return 0;
  const amount = Number(value);
  return Number.isNaN(amount) ? 0 : Math.max(0, amount);
};

const markInvoiceAsPaid = async (invoiceId) => {
  const invoice = await invoiceRepo.findById(invoiceId);
  if (!invoice) {
    throw new ServiceError('Invoice not found', 404);
  }

  if (invoice.status === 'PAID') {
    return invoice;
  }

  const updatedInvoice = await invoiceRepo.updateById(invoiceId, { status: 'PAID' });
  const chargeIds = (invoice.items || [])
    .map((it) => it.chargeId)
    .filter(Boolean);

  const chargeQuery = chargeIds.length > 0
    ? { $or: [{ invoiceId: invoice._id }, { _id: { $in: chargeIds } }] }
    : { invoiceId: invoice._id };

  await MedicalCharge.updateMany(chargeQuery, { $set: { billingStatus: 'PAID' } });
  return updatedInvoice;
};

const buildPayosChecksum = ({ clientId, apiKey, checksumKey, invoiceNumber, amount }) => {
  const payload = `${clientId}|${invoiceNumber}|${amount}|${apiKey}|${checksumKey}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
};

const resolveObjectIdString = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  if (typeof value.toString === 'function' && value.toString() !== '[object Object]') return value.toString();
  return null;
};

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const buildInvoiceFilter = (query) => {
  const filter = {};
  const search = query.search?.trim();
  const invoiceNumber = query.invoiceNumber?.trim();
  const status = query.status?.trim();
  const residentId = query.residentId?.trim();
  const familyAccountId = query.familyAccountId?.trim();
  const minAmount = Number(query.minAmount);
  const maxAmount = Number(query.maxAmount);

  if (search) {
    filter.$or = [{ invoiceNumber: { $regex: search, $options: 'i' } }];
    if (Types.ObjectId.isValid(search)) {
      filter.$or.push({ residentId: search });
      filter.$or.push({ familyAccountId: search });
    }
  }

  if (invoiceNumber) {
    filter.invoiceNumber = { $regex: invoiceNumber, $options: 'i' };
  }

  if (status) {
    filter.status = status;
  }

  if (residentId) {
    filter.residentId = residentId;
  }

  if (familyAccountId) {
    filter.familyAccountId = familyAccountId;
  }

  if (!Number.isNaN(minAmount) && minAmount >= 0) {
    filter.totalAmount = { ...filter.totalAmount, $gte: minAmount };
  }

  if (!Number.isNaN(maxAmount) && maxAmount >= 0) {
    filter.totalAmount = { ...filter.totalAmount, $lte: maxAmount };
  }

  if (query.issueFrom || query.issueTo) {
    filter.issuedAt = {};
    if (query.issueFrom) {
      const from = new Date(query.issueFrom);
      if (!Number.isNaN(from.getTime())) {
        filter.issuedAt.$gte = from;
      }
    }
    if (query.issueTo) {
      const to = new Date(query.issueTo);
      if (!Number.isNaN(to.getTime())) {
        filter.issuedAt.$lte = to;
      }
    }
  }

  if (query.dueFrom || query.dueTo) {
    filter.dueDate = {};
    if (query.dueFrom) {
      const from = new Date(query.dueFrom);
      if (!Number.isNaN(from.getTime())) {
        filter.dueDate.$gte = from;
      }
    }
    if (query.dueTo) {
      const to = new Date(query.dueTo);
      if (!Number.isNaN(to.getTime())) {
        filter.dueDate.$lte = to;
      }
    }
  }

  if (query.isOverdue === 'true') {
    const now = new Date();
    filter.dueDate = { ...filter.dueDate, $lt: now };
    filter.status = filter.status || { $ne: 'PAID' };
  }

  return filter;
};

const getPayosCredentials = () => {
  return {
    clientId: process.env.PAYOS_CLIENT_ID || '2077ca41-ed8b-46b4-b653-e952e07b62a8',
    apiKey: process.env.PAYOS_API_KEY || 'a55c117a-2218-4cc9-8afd-348e46f5178d',
    checksumKey: process.env.PAYOS_CHECKSUM_KEY || '2928b277a4b208bd9725946d9b5098013948863a43931e59ce5da5765dabccee',
    partnerCode: process.env.PAYOS_PARTNER_CODE,
  };
};

const getPayosApiBaseUrl = () => process.env.PAYOS_API_BASE_URL || 'https://api-merchant.payos.vn';

const getPayosPublicUrl = (req) => {
  const publicUrl = process.env.PAYOS_CHECKOUT_URL;
  if (publicUrl) {
    return publicUrl.replace(/\/$/, '');
  }
  if (!req) {
    throw new ServiceError('PAYOS_CHECKOUT_URL is not configured and request context is unavailable');
  }
  return `${req.protocol}://${req.get('host')}`;
};

const buildPayosPaymentSignature = ({ amount, cancelUrl, description, orderCode, returnUrl }) => {
  const signatureString = [
    `amount=${amount}`,
    `cancelUrl=${cancelUrl}`,
    `description=${description}`,
    `orderCode=${orderCode}`,
    `returnUrl=${returnUrl}`,
  ]
    .sort()
    .join('&');
  const { checksumKey } = getPayosCredentials();
  return crypto.createHmac('sha256', checksumKey).update(signatureString, 'utf8').digest('hex');
};

const buildPayosOrderCode = (invoice) => {
  const invoiceId = resolveObjectIdString(invoice._id) || `${Date.now()}`;
  const tail = invoiceId.slice(-8).replace(/[^0-9]/g, '');
  const nowSeconds = Math.floor(Date.now() / 1000).toString().slice(-6);
  return Number(`${nowSeconds}${tail || '0'}`);
};

const truncatePayosDescription = (text) => {
  if (!text) return text;
  return text.length <= 25 ? text : text.slice(0, 25);
};

const createPayosPaymentRequest = async ({ invoice, req }) => {
  const publicUrl = getPayosPublicUrl(req);
  const { clientId, apiKey, partnerCode } = getPayosCredentials();
  const orderCode = buildPayosOrderCode(invoice);
  const amount = Math.round(invoice.totalAmount || 0);
  const description = truncatePayosDescription(`Thanh toan hoa don ${invoice.invoiceNumber}`);
  
  // Handle batch invoiceIds
  let invoiceIdParam = encodeURIComponent(resolveObjectIdString(invoice._id));
  if (Array.isArray(invoice.invoiceIds) && invoice.invoiceIds.length > 0) {
    invoiceIdParam = invoice.invoiceIds.map(id => encodeURIComponent(resolveObjectIdString(id))).join(',');
  }
  
  const cancelUrl = `${publicUrl}/payos/cancel?invoiceId=${invoiceIdParam}`;
  const returnUrl = `${publicUrl}/payos/return?invoiceId=${invoiceIdParam}`;
  const signature = buildPayosPaymentSignature({ amount, cancelUrl, description, orderCode, returnUrl });

  const body = {
    orderCode,
    amount,
    description,
    cancelUrl,
    returnUrl,
    invoice: {
      buyerNotGetInvoice: true,
      taxPercentage: 0,
    },
    signature,
  };

  if (invoice.residentName) {
    body.buyerName = invoice.residentName;
  }
  if (invoice.buyerEmail) {
    body.buyerEmail = invoice.buyerEmail;
  }
  if (invoice.buyerPhone) {
    body.buyerPhone = invoice.buyerPhone;
  }

  const apiUrl = new URL('/v2/payment-requests', getPayosApiBaseUrl());
  const headers = {
    'Content-Type': 'application/json',
    'x-client-id': clientId,
    'x-api-key': apiKey,
  };
  if (partnerCode) {
    headers['x-partner-code'] = partnerCode;
  }

  const payload = JSON.stringify(body);
  headers['Content-Length'] = Buffer.byteLength(payload);

  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: apiUrl.hostname,
      port: apiUrl.port || 443,
      path: apiUrl.pathname + apiUrl.search,
      method: 'POST',
      headers,
    };

    const request = https.request(reqOptions, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody || '{}');
          if (response.statusCode >= 400 || parsed.code !== '00') {
            const message = parsed.desc || `PayOS request failed with status ${response.statusCode}`;
            return reject(new ServiceError(message, response.statusCode || 502));
          }
          return resolve(parsed.data || parsed);
        } catch (err) {
          return reject(new ServiceError(`Invalid PayOS response: ${err.message}`, 502));
        }
      });
    });

    request.on('error', (err) => reject(new ServiceError(`PayOS request error: ${err.message}`, 502)));
    request.write(payload);
    request.end();
  });
};

const getInvoiceFamilyAccountId = async (user, resident, overrideAccountId) => {
  if (overrideAccountId) return overrideAccountId;
  if (resident.familyPortalAccountIds?.length) return resident.familyPortalAccountIds[0];
  return user._id;
};

const getResidentServicePackagePrice = async (resident) => {
  if (!resident?.servicePackage) return null;
  const pkg = await servicePackageRepo.findByName(resident.servicePackage);
  return pkg?.monthlyPrice || null;
};

const getLatestMedicationUnitCost = async (medicationId) => {
  const stocks = await medicationStockRepo.findAll({ medicationId }, { sort: { receivedDate: -1 }, limit: 1 });
  if (!stocks || stocks.length === 0) return null;
  return stocks[0].costPerUnit || null;
};

const estimateMedicationCostFromPrescription = async (prescription) => {
  if (!prescription?.items?.length) return 0;
  const medicationIds = prescription.items
    .map((item) => (item.medicationId?._id ? item.medicationId._id : item.medicationId))
    .filter(Boolean);

  const unitCostMap = {};
  await Promise.all(
    medicationIds.map(async (medicationId) => {
      const cost = await getLatestMedicationUnitCost(medicationId);
      if (cost != null) {
        unitCostMap[String(medicationId)] = cost;
      }
    })
  );

  let estimatedCost = 0;
  for (const item of prescription.items) {
    const dosageValue = Number(item.dosage);
    const frequency = Number(item.frequency) || 0;
    const duration = Number(item.duration) || 1;
    const quantity = Number.isFinite(dosageValue) ? dosageValue * frequency * duration : 0;
    const medicationId = item.medicationId?._id ? item.medicationId._id : item.medicationId;
    const unitCost = unitCostMap[String(medicationId)] || 0;
    estimatedCost += quantity * unitCost;
  }

  return Math.round(Math.max(0, estimatedCost));
};

const estimateMedicationCostForPrescription = async (prescriptionId, residentId) => {
  if (!prescriptionId || !Types.ObjectId.isValid(prescriptionId)) {
    throw new ServiceError('Invalid prescriptionId provided', 400);
  }

  const prescription = await Prescription.findById(prescriptionId).populate('residentId');
  if (!prescription) {
    throw new ServiceError('Prescription not found', 404);
  }
  if (String(prescription.residentId._id || prescription.residentId) !== String(residentId)) {
    throw new ServiceError('Prescription does not belong to the resident', 400);
  }

  return await estimateMedicationCostFromPrescription(prescription);
};

const createInvoice = async (user, residentId, body) => {
  const resident = await residentRepo.findById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);

  if (user.role === 'family') {
    const familyResidentIds = await familyPortalRepo.getFamilyResidentIds(user._id);
    if (!familyResidentIds.includes(residentId.toString())) {
      throw new ServiceError('Access denied: not authorized to create invoice for this resident', 403);
    }
  }

  const familyAccountId = await getInvoiceFamilyAccountId(user, resident, body.familyAccountId);
  const roomCost = normalizeCost(body.roomCost);
  const medicationCostRaw = body.medicationCost;
  let medicationCost = normalizeCost(body.medicationCost);
  let careServiceCost = normalizeCost(body.careServiceCost);
  const otherCost = normalizeCost(body.otherCost);
  let prescriptionId = null;

  if (body.prescriptionId) {
    prescriptionId = resolveObjectIdString(body.prescriptionId);
    if (!prescriptionId || !Types.ObjectId.isValid(prescriptionId)) {
      throw new ServiceError('Invalid prescriptionId provided', 400);
    }

    const prescription = await Prescription.findById(prescriptionId).populate('residentId');
    if (!prescription) {
      throw new ServiceError('Prescription not found', 404);
    }
    if (String(prescription.residentId._id || prescription.residentId) !== String(residentId)) {
      throw new ServiceError('Prescription does not belong to the resident', 400);
    }

    if (medicationCostRaw === undefined || medicationCostRaw === '' || medicationCostRaw === null) {
      medicationCost = await estimateMedicationCostFromPrescription(prescription);
    }
  }
  // If caller provided explicit invoice items (service-line items), use them and ignore legacy cost fields
  if (body.items && Array.isArray(body.items) && body.items.length > 0) {
    const items = body.items.map((it) => ({
      chargeId: it.chargeId,
      description: it.description,
      amount: Number(it.amount) || 0,
      category: it.category || 'SERVICE',
    }));
    const subTotal = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const tax = Number(body.tax) || 0;
    const totalAmount = subTotal + tax;
    const { start, end } = buildDefaultBillingPeriod();
    const invoice = await invoiceRepo.create({
      invoiceNumber: buildInvoiceNumber(),
      residentId,
      familyAccountId,
      prescriptionId,
      billingPeriodStart: body.billingPeriodStart ? new Date(body.billingPeriodStart) : start,
      billingPeriodEnd: body.billingPeriodEnd ? new Date(body.billingPeriodEnd) : end,
      items,
      subTotal,
      tax,
      total: totalAmount,
      totalAmount,
      status: totalAmount === 0 ? 'PAID' : 'ISSUED',
      dueDate: body.dueDate ? new Date(body.dueDate) : end,
    });

    const chargeIds = items
      .map((it) => it.chargeId)
      .filter((id) => id)
      .map((id) => {
        if (Types.ObjectId.isValid(id)) return new Types.ObjectId(id);
        return null;
      })
      .filter(Boolean);

    if (chargeIds.length > 0) {
      await MedicalCharge.updateMany(
        { _id: { $in: chargeIds }, residentId },
        { $set: { billingStatus: 'BILLED', invoiceId: invoice._id } }
      );
    }

    await createAuditLog({
      actorUserId: user._id,
      actorRole: user.role,
      action: 'CREATE_INVOICE',
      module: 'billing',
      targetEntityType: 'Invoice',
      targetEntityId: invoice._id,
      afterData: invoice.toObject(),
    });
    return invoice;
  }

  if ((body.careServiceCost === undefined || body.careServiceCost === '' || body.careServiceCost === null) && resident.servicePackage && !prescriptionId) {
    const packagePrice = await getResidentServicePackagePrice(resident);
    if (packagePrice) {
      careServiceCost = packagePrice;
    }
  }

  const totalAmount = roomCost + medicationCost + careServiceCost + otherCost;
  const { start, end } = buildDefaultBillingPeriod();

  // Create separate invoices for SERVICE and MEDICATION
  const createdInvoices = [];

  // Create SERVICE invoice if there's a service cost
  if (careServiceCost > 0 || roomCost > 0 || (otherCost > 0 && medicationCost === 0)) {
    const serviceTotal = roomCost + careServiceCost + otherCost;
    const serviceInvoice = await invoiceRepo.create({
      invoiceNumber: buildInvoiceNumber(),
      residentId,
      familyAccountId,
      billingPeriodStart: body.billingPeriodStart ? new Date(body.billingPeriodStart) : start,
      billingPeriodEnd: body.billingPeriodEnd ? new Date(body.billingPeriodEnd) : end,
      roomCost,
      medicationCost: 0,
      careServiceCost,
      otherCost: medicationCost > 0 ? 0 : otherCost,
      totalAmount: serviceTotal,
      total: serviceTotal,
      type: 'SERVICE',
      status: serviceTotal === 0 ? 'PAID' : 'ISSUED',
      dueDate: body.dueDate ? new Date(body.dueDate) : end,
    });
    createdInvoices.push(serviceInvoice);
  }

  // Create MEDICATION invoice if there's medication cost
  if (medicationCost > 0) {
    const medicationInvoice = await invoiceRepo.create({
      invoiceNumber: buildInvoiceNumber(),
      residentId,
      familyAccountId,
      prescriptionId,
      billingPeriodStart: body.billingPeriodStart ? new Date(body.billingPeriodStart) : start,
      billingPeriodEnd: body.billingPeriodEnd ? new Date(body.billingPeriodEnd) : end,
      roomCost: 0,
      medicationCost,
      careServiceCost: 0,
      otherCost: body.otherCost || 0,
      totalAmount: medicationCost + (body.otherCost || 0),
      total: medicationCost + (body.otherCost || 0),
      type: 'MEDICATION',
      status: 'ISSUED',
      dueDate: body.dueDate ? new Date(body.dueDate) : end,
    });
    createdInvoices.push(medicationInvoice);
  }

  if (body.billingPeriodStart && body.billingPeriodEnd) {
    const startDate = new Date(body.billingPeriodStart);
    const endDate = new Date(body.billingPeriodEnd);
    if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
      await Admission.findOneAndUpdate(
        {
          residentId,
          status: { $in: ['checked_in', 'contracting'] },
          contractNumber: { $exists: true, $ne: null },
        },
        {
          contractStartDate: startDate,
          contractEndDate: endDate,
        },
        { new: true, runValidators: true }
      );
    }
  }

  // Log audit for all created invoices
  for (const invoice of createdInvoices) {
    await createAuditLog({
      actorUserId: user._id,
      actorRole: user.role,
      action: 'CREATE_INVOICE',
      module: 'billing',
      targetEntityType: 'Invoice',
      targetEntityId: invoice._id,
      afterData: invoice.toObject(),
    });
  }

  // Return the first (primary) invoice or all invoices based on API contract
  return createdInvoices.length > 0 ? createdInvoices[0] : null;
};

const buildPayosCheckoutUrl = (req, invoice) => {
  const { clientId, apiKey, checksumKey } = getPayosCredentials();
  const checksum = buildPayosChecksum({ clientId, apiKey, checksumKey, invoiceNumber: invoice.invoiceNumber, amount: invoice.totalAmount });
  const baseUrl = process.env.PAYOS_CHECKOUT_URL || `${req.protocol}://${req.get('host')}`;
  const residentId = resolveObjectIdString(invoice.residentId) || invoice.residentId;
  return `${baseUrl}/api/residents/${encodeURIComponent(residentId)}/invoices/payos/checkout/${encodeURIComponent(invoice._id)}?clientId=${encodeURIComponent(clientId)}&checksum=${encodeURIComponent(checksum)}`;
};

const buildPayosWalletTopupUrl = (req, topupData) => {
  const { clientId, apiKey, checksumKey } = getPayosCredentials();
  const checksum = buildPayosChecksum({ clientId, apiKey, checksumKey, invoiceNumber: topupData.invoiceNumber, amount: topupData.amount });
  const baseUrl = process.env.PAYOS_CHECKOUT_URL || `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/api/family/wallet/topup/payos/checkout/${encodeURIComponent(topupData._id)}?clientId=${encodeURIComponent(clientId)}&checksum=${encodeURIComponent(checksum)}&amount=${encodeURIComponent(topupData.amount)}`;
};

const verifyPayosCheckoutChecksum = (invoice, clientId, checksum) => {
  if (!clientId || !checksum) return false;
  const { apiKey, checksumKey } = getPayosCredentials();
  const expected = buildPayosChecksum({ clientId, apiKey, checksumKey, invoiceNumber: invoice.invoiceNumber, amount: invoice.totalAmount });
  return expected === checksum;
};

const verifyPayosWalletTopupChecksum = (topupId, amount, clientId, checksum) => {
  if (!clientId || !checksum || !topupId || !amount) return false;
  const { apiKey, checksumKey } = getPayosCredentials();
  const invoiceNumber = `TOPUP-${topupId.split('_').pop()}`;
  const expected = buildPayosChecksum({ clientId, apiKey, checksumKey, invoiceNumber, amount: parseInt(amount) });
  return expected === checksum;
};

const assertInvoiceAccess = async (user, invoice) => {
  if (['doctor', 'nurse', 'admin'].includes(user.role)) return;

  const invoiceFamilyAccountId = resolveObjectIdString(invoice.familyAccountId);
  const invoiceResidentId = resolveObjectIdString(invoice.residentId);
  const userIdString = String(user._id);
  const residentUserIdString = String(user.residentId || user._id);

  if (user.role === 'family') {
    if (invoiceFamilyAccountId === userIdString) return;
    const familyResidentIds = await familyPortalRepo.getFamilyResidentIds(user._id);
    if (invoiceResidentId && familyResidentIds.includes(invoiceResidentId)) return;
  }

  if (user.role === 'resident' && invoiceResidentId === residentUserIdString) return;

  throw new ServiceError('Access denied: not authorized to view this invoice', 403);
};

const findInvoiceById = async (user, invoiceId) => {
  const invoice = await invoiceRepo.findById(invoiceId);
  if (!invoice) throw new ServiceError('Invoice not found', 404);
  await assertInvoiceAccess(user, invoice);
  return invoice;
};

const findInvoiceForCheckout = async (user, residentId, invoiceId, query = {}) => {
  const invoice = await invoiceRepo.findById(invoiceId);
  if (!invoice) throw new ServiceError('Invoice not found', 404);

  const invoiceResidentId = resolveObjectIdString(invoice.residentId);
  if (!invoiceResidentId || invoiceResidentId !== residentId) {
    throw new ServiceError('Invoice does not belong to the requested resident', 403);
  }

  if (user) {
    await assertInvoiceAccess(user, invoice);
    return invoice;
  }

  if (verifyPayosCheckoutChecksum(invoice, query.clientId, query.checksum)) {
    return invoice;
  }

  throw new ServiceError('Access denied: not authorized to view this invoice', 403);
};

const recordPayment = async (user, invoiceId, body) => {
  const invoice = await findInvoiceById(user, invoiceId);

  if (invoice.status === 'PAID') {
    throw new ServiceError('Invoice is already fully paid', 400);
  }

  const amount = normalizeCost(body.amount || invoice.totalAmount);
  if (amount <= 0) throw new ServiceError('Payment amount must be greater than 0', 400);

  if (body.transactionRef) {
    const existingPayment = await paymentRepo.findByTransactionRef(body.transactionRef);
    if (existingPayment) {
      throw new ServiceError('Duplicate payment: transactionRef already exists', 409);
    }
  }

  const payment = await paymentRepo.create({
    invoiceId,
    paidByFamilyAccountId: user._id,
    paymentMethod: body.paymentMethod || 'card',
    transactionRef: body.transactionRef || `PAY-${Date.now()}`,
    amount,
    paymentStatus: 'confirmed',
    paidAt: new Date(),
    confirmedAt: new Date(),
    note: body.note,
  });

  const status = amount >= invoice.totalAmount ? 'PAID' : 'PARTIALLY_PAID';

  const updatedInvoice = await invoiceRepo.updateById(invoiceId, { status });
  if (status === 'PAID') {
    await markInvoiceAsPaid(invoiceId);
  }

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'RECORD_PAYMENT',
    module: 'billing',
    targetEntityType: 'Payment',
    targetEntityId: payment._id,
    afterData: payment.toObject(),
  });

  return payment;
};

const adminListInvoices = async (query) => {
  const filter = buildInvoiceFilter(query);
  const { pageNum, limitNum, skip } = parsePagination(query);
  const sortBy = ['issuedAt', 'dueDate', 'totalAmount', 'invoiceNumber'].includes(query.sortBy)
    ? query.sortBy
    : 'issuedAt';
  const sortDirection = query.sortOrder === 'asc' ? 1 : -1;

  const [data, total] = await Promise.all([
    invoiceRepo.findAll(filter, { sort: { [sortBy]: sortDirection }, skip, limit: limitNum }),
    invoiceRepo.countAll(filter),
  ]);

  return {
    data,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.max(Math.ceil(total / limitNum), 1),
  };
};

const adminGetInvoice = async (invoiceId) => {
  const invoice = await invoiceRepo.findById(invoiceId);
  if (!invoice) throw new ServiceError('Invoice not found', 404);
  return invoice;
};

const listInvoicesByResident = async (residentId) => {
  const filter = { residentId: new Types.ObjectId(residentId) };
  const invoices = await invoiceRepo.findAll(filter, { sort: { createdAt: -1 } });
  return invoices || [];
};

const getPayosPaymentStatus = async (orderCode) => {
  const { clientId, apiKey, partnerCode } = getPayosCredentials();
  const apiUrl = new URL(`/v2/payment-requests/${orderCode}`, getPayosApiBaseUrl());
  const headers = {
    'x-client-id': clientId,
    'x-api-key': apiKey,
  };
  if (partnerCode) headers['x-partner-code'] = partnerCode;

  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: apiUrl.hostname,
      port: apiUrl.port || 443,
      path: apiUrl.pathname + apiUrl.search,
      method: 'GET',
      headers,
    };

    const request = https.request(reqOptions, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody || '{}');
          if (parsed.code !== '00') {
            return reject(new ServiceError(parsed.desc || `PayOS status check failed: ${response.statusCode}`, 502));
          }
          return resolve(parsed.data || {});
        } catch (err) {
          return reject(new ServiceError(`Invalid PayOS response: ${err.message}`, 502));
        }
      });
    });

    request.on('error', (err) => reject(new ServiceError(`PayOS request error: ${err.message}`, 502)));
    request.end();
  });
};

const batchPayment = async (user, residentId, invoiceIds, body, req) => {
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    throw new ServiceError('No invoices selected for payment', 400);
  }

  // Fetch all invoices
  const invoices = await invoiceRepo.findAll({ _id: { $in: invoiceIds }, residentId });
  
  if (invoices.length !== invoiceIds.length) {
    throw new ServiceError('Some invoices not found or do not belong to this resident', 404);
  }

  // Calculate total amount
  let totalAmount = 0;
  invoices.forEach((invoice) => {
    totalAmount += invoice.totalAmount || 0;
  });

  const amount = body.amount ? normalizeCost(body.amount) : totalAmount;
  if (amount <= 0) {
    throw new ServiceError('Payment amount must be greater than 0', 400);
  }

  // For PayOS payment, return checkout URL without creating payment records yet
  if (body.paymentMethod === 'payos') {
    // Create a combined invoice object for PayOS
    const combinedInvoice = {
      _id: invoiceIds[0], // Use first invoice ID for reference
      invoiceNumber: `BATCH-${invoiceIds.length}-${new Date().getTime()}`,
      totalAmount: amount,
      residentId,
      invoiceIds, // Store all invoice IDs
    };

    const payosData = await createPayosPaymentRequest({ invoice: combinedInvoice, req });
    return {
      totalPaid: amount,
      invoiceCount: invoices.length,
      checkoutUrl: payosData.checkoutUrl,
      paymentType: 'batch_payos',
      invoiceIds,
    };
  }

  // For wallet/other payment methods, create payment records immediately
  const payments = [];
  let remainingAmount = amount;

  for (let i = 0; i < invoices.length; i++) {
    const invoice = invoices[i];
    const invoiceAmount = Math.min(remainingAmount, invoice.totalAmount);

    if (invoiceAmount > 0) {
      const payment = await paymentRepo.create({
        invoiceId: invoice._id,
        paidByFamilyAccountId: user._id,
        paymentMethod: body.paymentMethod || 'card',
        transactionRef: body.transactionRef || `PAY-${Date.now()}-${i}`,
        amount: invoiceAmount,
        paymentStatus: 'confirmed',
        paidAt: new Date(),
        confirmedAt: new Date(),
        note: body.note,
      });

      payments.push(payment);
      
      // Update invoice status
      const status = invoiceAmount >= invoice.totalAmount ? 'PAID' : 'PARTIALLY_PAID';
      await invoiceRepo.updateById(invoice._id, { status });
      
      if (status === 'PAID') {
        await markInvoiceAsPaid(invoice._id);
      }

      remainingAmount -= invoiceAmount;
      
      // Log audit
      await createAuditLog({
        actorUserId: user._id,
        actorRole: user.role,
        action: 'BATCH_PAYMENT',
        module: 'billing',
        targetEntityType: 'Payment',
        targetEntityId: payment._id,
        afterData: payment.toObject(),
      });
    }
  }

  return {
    totalPaid: amount,
    invoiceCount: invoices.length,
    payments,
    paymentType: 'batch_wallet',
  };
};

module.exports = {
  createInvoice,
  estimateMedicationCostForPrescription,
  buildPayosCheckoutUrl,
  buildPayosWalletTopupUrl,
  createPayosPaymentRequest,
  getPayosPaymentStatus,
  findInvoiceById,
  findInvoiceForCheckout,
  recordPayment,
  markInvoiceAsPaid,
  verifyPayosWalletTopupChecksum,
  adminListInvoices,
  adminGetInvoice,
  listInvoicesByResident,
  batchPayment,
};

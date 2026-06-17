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
  const cancelUrl = `${publicUrl}/payos/cancel?invoiceId=${encodeURIComponent(resolveObjectIdString(invoice._id))}`;
  const returnUrl = `${publicUrl}/payos/return?invoiceId=${encodeURIComponent(resolveObjectIdString(invoice._id))}`;
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

  if ((body.careServiceCost === undefined || body.careServiceCost === '' || body.careServiceCost === null) && resident.servicePackage) {
    const packagePrice = await getResidentServicePackagePrice(resident);
    if (packagePrice) {
      careServiceCost = packagePrice;
    }
  }

  const totalAmount = roomCost + medicationCost + careServiceCost + otherCost;
  const { start, end } = buildDefaultBillingPeriod();

  const invoice = await invoiceRepo.create({
    invoiceNumber: buildInvoiceNumber(),
    residentId,
    familyAccountId,
    prescriptionId,
    billingPeriodStart: body.billingPeriodStart ? new Date(body.billingPeriodStart) : start,
    billingPeriodEnd: body.billingPeriodEnd ? new Date(body.billingPeriodEnd) : end,
    roomCost,
    medicationCost,
    careServiceCost,
    otherCost,
    totalAmount,
    status: totalAmount === 0 ? 'paid' : 'issued',
    dueDate: body.dueDate ? new Date(body.dueDate) : end,
  });

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

  const amount = normalizeCost(body.amount || invoice.totalAmount);
  if (amount <= 0) throw new ServiceError('Payment amount must be greater than 0', 400);

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

  const status = amount >= invoice.totalAmount ? 'paid' : 'partially_paid';
  await invoiceRepo.updateById(invoiceId, { status });

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
  verifyPayosWalletTopupChecksum,
};

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
const medicationDispenseRepo = require('../repositories/medicationDispenseRepository');
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

const normalizeInvoiceIssueDate = (invoice) => {
  if (!invoice) return invoice;
  if (!invoice.issuedAt && invoice.createdAt) {
    invoice.issuedAt = invoice.createdAt;
  }
  return invoice;
};

const applyPaymentPlanToAmount = (amount, paymentPlan) => {
  const numericAmount = Number(amount) || 0;
  if (String(paymentPlan || '').toUpperCase() === 'HALF_NOW') {
    return Math.round(numericAmount / 2);
  }
  return numericAmount;
};

const isUnpaidInvoice = (invoice) => ['DRAFT', 'ISSUED', 'PARTIALLY_PAID'].includes(invoice?.status);

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
  // If this invoice represents medication charges for a prescription, create MedicationDispense
  try {
    if (String(invoice.type || '').toUpperCase() === 'MEDICATION' && invoice.prescriptionId) {
      const prescription = await Prescription.findById(invoice.prescriptionId).lean();
      if (prescription && Array.isArray(prescription.items) && prescription.items.length > 0) {
        // aggregate quantities per medicationId
        const qtyMap = {};
        prescription.items.forEach((it) => {
          try {
            const medId = it.medicationId?._id || it.medicationId;
            if (!medId) return;
            const dosage = Number(it.dosage) || 1;
            const frequency = Number(it.frequency) || 1;
            const duration = Number(it.duration) || 1;
            const qty = Math.max(0, Math.round(dosage * frequency * duration));
            if (qty <= 0) return;
            const key = String(medId);
            qtyMap[key] = (qtyMap[key] || 0) + qty;
          } catch (e) {
            // ignore per-item parse errors
          }
        });

        for (const medKey of Object.keys(qtyMap)) {
          const medicationId = medKey;
          const quantity = qtyMap[medKey];
          try {
            await medicationDispenseRepo.create({
              medicationId,
              prescriptionId: invoice.prescriptionId,
              residentId: invoice.residentId,
              quantity,
              dispensedByUserId: null,
              dispensedAt: new Date(),
              notes: `Auto-dispensed on invoice payment: ${invoice._id}`,
            });
          } catch (err) {
            // Log and continue — do not block payment finalization
            console.error('Auto-dispense on payment failed for medication', medicationId, err.message || err);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error during auto-dispense on invoice payment:', err.message || err);
  }
  return updatedInvoice;
};

// Persist the PayOS orderCode created for this invoice's checkout so we can later verify the
// real payment status with PayOS instead of trusting a client-supplied "status" query param.
const storeInvoicePayosOrderCode = async (invoiceId, orderCode) => {
  if (!invoiceId || !orderCode) return;
  const ids = Array.isArray(invoiceId) ? invoiceId : [invoiceId];
  await Promise.all(ids.map((id) => invoiceRepo.updateById(id, { payosOrderCode: Number(orderCode) })));
};

// Called from the (signature-verified) PayOS webhook: the webhook payload itself already IS the
// verified confirmation, so this looks invoices up by the orderCode PayOS reports and marks them
// paid directly, without a further PayOS API round-trip.
const confirmInvoicesByOrderCode = async (orderCode) => {
  const invoices = await invoiceRepo.findByPayosOrderCode(orderCode);
  const paid = [];
  for (const invoice of invoices) {
    if (invoice.status === 'PAID') continue;
    const updated = await markInvoiceAsPaid(invoice._id);
    paid.push(updated);
  }
  return paid;
};

// Verify the real payment status with PayOS (server-to-server) before marking an invoice paid.
// This is the safe counterpart to the old handleReturn behaviour, which trusted the return-URL
// query string directly.
const verifyAndMarkInvoicePaid = async (invoiceId) => {
  const invoice = await invoiceRepo.findById(invoiceId);
  if (!invoice) return { status: 'NOT_FOUND' };
  if (invoice.status === 'PAID') return { status: 'PAID', invoice };

  if (!invoice.payosOrderCode) {
    // No checkout was ever created through the tracked flow — nothing to verify against.
    return { status: 'PENDING' };
  }

  let paymentData;
  try {
    paymentData = await getPayosPaymentStatus(invoice.payosOrderCode);
  } catch (err) {
    console.warn('[verifyAndMarkInvoicePaid] PayOS API error:', err.message);
    return { status: 'PENDING' };
  }

  const payosStatus = String(paymentData.status || 'PENDING').toUpperCase();
  if (payosStatus === 'PAID') {
    const updated = await markInvoiceAsPaid(invoiceId);
    return { status: 'PAID', invoice: updated };
  }
  return { status: payosStatus };
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
  const andFilters = [];

  if (search) {
    const searchClauses = [{ invoiceNumber: { $regex: search, $options: 'i' } }];
    if (Types.ObjectId.isValid(search)) {
      searchClauses.push({ residentId: search });
      searchClauses.push({ familyAccountId: search });
    }
    andFilters.push({ $or: searchClauses });
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
    const issueRange = {};
    if (query.issueFrom) {
      const from = new Date(query.issueFrom);
      if (!Number.isNaN(from.getTime())) {
        issueRange.$gte = from;
      }
    }
    if (query.issueTo) {
      const to = new Date(query.issueTo);
      if (!Number.isNaN(to.getTime())) {
        issueRange.$lte = to;
      }
    }
    if (Object.keys(issueRange).length > 0) {
      andFilters.push({
        $or: [
          { issuedAt: issueRange },
          { createdAt: issueRange },
        ],
      });
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

  if (andFilters.length > 0) {
    filter.$and = andFilters;
  }

  if (query.isOverdue === 'true') {
    const now = new Date();
    filter.dueDate = { ...filter.dueDate, $lt: now };
    filter.status = filter.status || { $ne: 'PAID' };
  }

  return filter;
};

const getPayosCredentials = () => {
  const { PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY, PAYOS_PARTNER_CODE } = process.env;
  if (!PAYOS_CLIENT_ID || !PAYOS_API_KEY || !PAYOS_CHECKSUM_KEY) {
    // No hardcoded fallback on purpose — a previous version of this code fell back to real
    // credentials that ended up committed to the repo. Fail fast instead of silently reusing
    // (now-untrusted) leaked keys.
    throw new ServiceError('PayOS is not configured: set PAYOS_CLIENT_ID, PAYOS_API_KEY, and PAYOS_CHECKSUM_KEY', 500);
  }
  return {
    clientId: PAYOS_CLIENT_ID,
    apiKey: PAYOS_API_KEY,
    checksumKey: PAYOS_CHECKSUM_KEY,
    partnerCode: PAYOS_PARTNER_CODE,
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
  if (invoice.status === 'CANCELLED') {
    throw new ServiceError('Không thể thanh toán hóa đơn đã bị hủy.', 400);
  }
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
  const stocks = await medicationStockRepo.findAll(
    { medicationId, costPerUnit: { $exists: true, $ne: null } },
    { sort: { receivedDate: -1 }, limit: 1 }
  );
  if (!stocks || stocks.length === 0) return null;
  const latestStock = stocks[0];
  return latestStock.costPerUnit != null ? Number(latestStock.costPerUnit) : null;
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
    if (item.isActive === false) continue;
    const dosageValue = Number(item.dosage);
    const frequency = Number(item.frequency) || 0;
    let effectiveDays = 0;

    if (item.startDate) {
      const start = new Date(item.startDate);
      if (!Number.isNaN(start.getTime())) {
        let end = null;
        if (item.endDate) {
          const itemEnd = new Date(item.endDate);
          if (!Number.isNaN(itemEnd.getTime()) && itemEnd >= start) {
            end = itemEnd;
          }
        }
        if (prescription.validUntil) {
          const validUntilEnd = new Date(prescription.validUntil);
          if (!Number.isNaN(validUntilEnd.getTime()) && validUntilEnd >= start) {
            end = end ? (validUntilEnd > end ? validUntilEnd : end) : validUntilEnd;
          }
        }
        if (end) {
          effectiveDays = Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
        }
      }
    }

    if (effectiveDays <= 0 && item.duration && Number(item.duration) > 0) {
      effectiveDays = Number(item.duration);
    }

    if (effectiveDays <= 0) effectiveDays = 1;
    const quantity = Number.isFinite(dosageValue) ? dosageValue * frequency * effectiveDays : 0;
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

  if (body.admissionId) {
    if (!Types.ObjectId.isValid(body.admissionId)) {
      throw new ServiceError('Invalid admissionId provided', 400);
    }
    const admission = await Admission.findById(body.admissionId).select('residentId contractNumber').lean();
    if (!admission) throw new ServiceError('Admission request not found', 404);
    if (String(admission.residentId) !== String(residentId)) {
      throw new ServiceError('Admission request does not belong to the resident', 400);
    }
    if (!admission.contractNumber) {
      throw new ServiceError('Vui lòng tạo hợp đồng trước khi tạo hóa đơn.', 400);
    }
  }

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

  const existingInvoices = await invoiceRepo.findByResidentId(residentId, { sort: { createdAt: -1 }, limit: 100 });
  const pendingServiceInvoice = existingInvoices.find((invoice) =>
    isUnpaidInvoice(invoice)
    && ['SERVICE', 'COMBINED'].includes(invoice.type)
    && Number(invoice.careServiceCost || 0) > 0
  );
  const pendingMedicationInvoice = existingInvoices.find((invoice) =>
    isUnpaidInvoice(invoice)
    && invoice.type === 'MEDICATION'
    && (!body.prescriptionId || String(invoice.prescriptionId || '') === String(body.prescriptionId))
  );

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
    if (pendingServiceInvoice) {
      throw new ServiceError('Đã có hóa đơn dịch vụ chưa thanh toán cho cư dân này.', 409);
    }
    const rawSubTotal = body.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const rawTax = Number(body.tax) || 0;
    const items = body.items.map((it) => ({
      chargeId: it.chargeId,
      description: it.description,
      amount: applyPaymentPlanToAmount(it.amount, body.paymentPlan),
      category: it.category || 'SERVICE',
    }));
    const subTotal = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const tax = applyPaymentPlanToAmount(rawTax, body.paymentPlan);
    const totalAmount = subTotal + tax;
    const originalTotalAmount = rawSubTotal + rawTax;
    const remainingAmount = String(body.paymentPlan || 'FULL').toUpperCase() === 'HALF_NOW'
      ? Math.max(0, originalTotalAmount - totalAmount)
      : 0;
    const { start, end } = buildDefaultBillingPeriod();
    const invoiceData = {
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
      originalTotalAmount,
      remainingAmount,
      paymentPlan: body.paymentPlan || 'FULL',
      status: totalAmount === 0 ? 'PAID' : 'ISSUED',
      dueDate: body.dueDate ? new Date(body.dueDate) : end,
    };

    const invoice = await invoiceRepo.create(invoiceData);

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
    if (pendingServiceInvoice) {
      throw new ServiceError('Đã có hóa đơn dịch vụ chưa thanh toán cho cư dân này.', 409);
    }
    const serviceTotal = roomCost + careServiceCost + otherCost;
    const effectiveRoomCost = applyPaymentPlanToAmount(roomCost, body.paymentPlan);
    const effectiveCareServiceCost = applyPaymentPlanToAmount(careServiceCost, body.paymentPlan);
    const effectiveOtherCost = medicationCost > 0 ? 0 : applyPaymentPlanToAmount(otherCost, body.paymentPlan);
    const serviceInvoiceTotal = effectiveRoomCost + effectiveCareServiceCost + effectiveOtherCost;

    const fullServiceTotal = roomCost + careServiceCost + otherCost;
    const serviceInvoice = await invoiceRepo.create({
      invoiceNumber: buildInvoiceNumber(),
      residentId,
      familyAccountId,
      billingPeriodStart: body.billingPeriodStart ? new Date(body.billingPeriodStart) : start,
      billingPeriodEnd: body.billingPeriodEnd ? new Date(body.billingPeriodEnd) : end,
      roomCost: effectiveRoomCost,
      medicationCost: 0,
      careServiceCost: effectiveCareServiceCost,
      otherCost: effectiveOtherCost,
      totalAmount: serviceInvoiceTotal,
      total: serviceInvoiceTotal,
      originalTotalAmount: fullServiceTotal,
      remainingAmount: String(body.paymentPlan || 'FULL').toUpperCase() === 'HALF_NOW'
        ? Math.max(0, fullServiceTotal - serviceInvoiceTotal)
        : 0,
      paymentPlan: body.paymentPlan || 'FULL',
      type: 'SERVICE',
      status: serviceInvoiceTotal === 0 ? 'PAID' : 'ISSUED',
      dueDate: body.dueDate ? new Date(body.dueDate) : end,
    });
    createdInvoices.push(serviceInvoice);
  }

  // Create MEDICATION invoice if there's medication cost
  if (medicationCost > 0) {
    if (pendingMedicationInvoice) {
      throw new ServiceError('Đã có hóa đơn thuốc chưa thanh toán cho đơn thuốc này.', 409);
    }
    const effectiveMedicationCost = applyPaymentPlanToAmount(medicationCost, body.paymentPlan);
    const effectiveMedicationOtherCost = applyPaymentPlanToAmount(body.otherCost || 0, body.paymentPlan);
    const medicationInvoiceTotal = effectiveMedicationCost + effectiveMedicationOtherCost;

    const fullMedicationTotal = medicationCost + (body.otherCost || 0);
    const medicationInvoice = await invoiceRepo.create({
      invoiceNumber: buildInvoiceNumber(),
      residentId,
      familyAccountId,
      prescriptionId,
      billingPeriodStart: body.billingPeriodStart ? new Date(body.billingPeriodStart) : start,
      billingPeriodEnd: body.billingPeriodEnd ? new Date(body.billingPeriodEnd) : end,
      roomCost: 0,
      medicationCost: effectiveMedicationCost,
      careServiceCost: 0,
      otherCost: effectiveMedicationOtherCost,
      totalAmount: medicationInvoiceTotal,
      total: medicationInvoiceTotal,
      originalTotalAmount: fullMedicationTotal,
      remainingAmount: String(body.paymentPlan || 'FULL').toUpperCase() === 'HALF_NOW'
        ? Math.max(0, fullMedicationTotal - medicationInvoiceTotal)
        : 0,
      paymentPlan: body.paymentPlan || 'FULL',
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
  if (invoice.status === 'CANCELLED') {
    throw new ServiceError('Không thể mở thanh toán cho hóa đơn đã bị hủy.', 400);
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
  if (invoice.status === 'CANCELLED') {
    throw new ServiceError('Không thể thanh toán hóa đơn đã bị hủy.', 400);
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
  const sort = sortBy === 'issuedAt'
    ? { issuedAt: sortDirection, createdAt: sortDirection }
    : { [sortBy]: sortDirection };

  const [data, total] = await Promise.all([
    invoiceRepo.findAll(filter, { sort, skip, limit: limitNum }),
    invoiceRepo.countAll(filter),
  ]);

  return {
    data: (data || []).map(normalizeInvoiceIssueDate),
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.max(Math.ceil(total / limitNum), 1),
  };
};

const adminGetInvoice = async (invoiceId) => {
  const invoice = await invoiceRepo.findById(invoiceId);
  if (!invoice) throw new ServiceError('Invoice not found', 404);
  return normalizeInvoiceIssueDate(invoice);
};

const listInvoicesByResident = async (user, residentId) => {
  if (user && !['doctor', 'nurse', 'admin'].includes(user.role)) {
    if (user.role === 'family') {
      const familyResidentIds = await familyPortalRepo.getFamilyResidentIds(user._id);
      if (!familyResidentIds.includes(String(residentId))) {
        throw new ServiceError('Access denied: not authorized to view invoices for this resident', 403);
      }
    } else if (user.role === 'resident') {
      if (String(user.residentId || user._id) !== String(residentId)) {
        throw new ServiceError('Access denied: not authorized to view invoices for this resident', 403);
      }
    }
  }
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
    if (payosData.orderCode) {
      await storeInvoicePayosOrderCode(invoiceIds, payosData.orderCode);
    }
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
  storeInvoicePayosOrderCode,
  verifyAndMarkInvoicePaid,
  confirmInvoicesByOrderCode,
};

const { Types } = require('mongoose');
const ServiceError = require('./serviceError');
const invoiceRepo = require('../repositories/invoiceRepository');
const contractRepo = require('../repositories/contractRepository');
const servicePackageRepo = require('../repositories/servicePackageRepository');
const admissionRepo = require('../repositories/admissionRepository');
const { createAuditLog } = require('../utils/auditLog');

const buildInvoiceNumber = () => 
  `INV-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 9000) + 1000}`;

/**
 * UC-128: Create Invoice from Contract
 * 
 * Flow: Doctor khám → Tạo Hợp đồng → Tạo Hóa đơn
 * 
 * This is called AFTER the contract has been created.
 * The contract info (discount, duration, service package) determines the invoice amount.
 */
const createInvoiceFromContract = async (admin, contractId, body, req) => {
  const contract = await contractRepo.findById(contractId);
  if (!contract) {
    throw new ServiceError('Không tìm thấy hợp đồng', 404);
  }

  if (contract.status !== 'active') {
    throw new ServiceError(
      `Chỉ có thể tạo hóa đơn cho hợp đồng đang hoạt động. Trạng thái hiện tại: ${contract.status}`,
      400
    );
  }

  // Check if there's already a pending service invoice for this contract
  const existingInvoices = await invoiceRepo.findAll({
    contractId: contract._id,
    status: { $in: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID'] },
  });
  
  const hasPendingServiceInvoice = existingInvoices.some(
    (inv) => ['SERVICE', 'COMBINED'].includes(inv.type) && (inv.careServiceCost || 0) > 0
  );
  if (hasPendingServiceInvoice) {
    throw new ServiceError('Đã có hóa đơn dịch vụ chưa thanh toán cho hợp đồng này.', 409);
  }

  // Calculate care service cost
  let monthlyFee = Number(contract.monthlyFee) || 0;
  let durationMonths = Number(contract.durationMonths) || 0;
  
  // Override from body if provided
  if (body?.careServiceCost !== undefined) {
    monthlyFee = Number(body.careServiceCost);
  }
  if (body?.durationMonths !== undefined) {
    durationMonths = Number(body.durationMonths);
  }

  if (monthlyFee <= 0 || durationMonths <= 0) {
    throw new ServiceError('Không thể tạo hóa đơn: phí dịch vụ hoặc thời hạn không hợp lệ.', 400);
  }

  const rawTotal = monthlyFee * durationMonths;
  const discountPercent = Number(contract.discountPercent) || 0;
  const discountAmount = Math.round(rawTotal * (discountPercent / 100));
  const finalAmount = rawTotal - discountAmount;

  // Build billing period from contract dates
  const billingPeriodStart = body?.billingPeriodStart 
    ? new Date(body.billingPeriodStart) 
    : (contract.startDate ? new Date(contract.startDate) : new Date());
  const billingPeriodEnd = body?.billingPeriodEnd
    ? new Date(body.billingPeriodEnd)
    : (contract.endDate ? new Date(contract.endDate) : new Date());

  // Build line items
  const items = [
    {
      description: `Phí dịch vụ chăm sóc - Hợp đồng ${contract.contractNumber}`,
      amount: finalAmount,
      category: 'SERVICE',
    },
  ];

  // Optional room cost
  if (body?.roomCost && Number(body.roomCost) > 0) {
    items.push({
      description: 'Phí phòng',
      amount: Number(body.roomCost),
      category: 'ROOM',
    });
  }

  // Build invoice
  const invoiceData = {
    invoiceNumber: buildInvoiceNumber(),
    residentId: contract.residentId,
    familyAccountId: contract.familyAccountId,
    contractId: contract._id,
    admissionId: contract.admissionId,
    billingPeriodStart,
    billingPeriodEnd,
    items,
    subTotal: finalAmount + (Number(body?.roomCost) || 0),
    tax: 0,
    total: finalAmount + (Number(body?.roomCost) || 0),
    totalAmount: finalAmount + (Number(body?.roomCost) || 0),
    originalTotalAmount: rawTotal + (Number(body?.roomCost) || 0),
    remainingAmount: discountAmount > 0 ? discountAmount : 0,
    roomCost: Number(body?.roomCost) || 0,
    medicationCost: 0,
    careServiceCost: finalAmount,
    otherCost: 0,
    paymentPlan: body?.paymentPlan || 'FULL',
    type: 'SERVICE',
    status: 'ISSUED',
    dueDate: body?.dueDate ? new Date(body.dueDate) : billingPeriodEnd,
    issuedAt: new Date(),
    createdBy: admin._id?.toString(),
    createdAt: new Date(),
  };

  const invoice = await invoiceRepo.create(invoiceData);

  // Update admission with billing period
  await admissionRepo.updateAdmission(contract.admissionId, {
    contractStartDate: billingPeriodStart,
    contractEndDate: billingPeriodEnd,
  });

  // Audit log
  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'CREATE_INVOICE_FROM_CONTRACT',
    module: 'contract',
    businessModule: 'contract',
    targetEntityType: 'Invoice',
    targetEntityId: invoice._id,
    targetName: invoice.invoiceNumber || invoice._id?.toString(),
    performedBy: admin.fullName || admin.email,
    performedByRole: admin.role,
    description: `${admin.fullName || admin.email || 'Quản trị viên'} đã tạo hóa đơn ${invoice.invoiceNumber} từ hợp đồng ${contract.contractNumber}.`,
    beforeData: {
      contractId: contract._id,
      contractNumber: contract.contractNumber,
    },
    afterData: {
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      contractId: contract._id,
      totalAmount: invoice.totalAmount,
      discountPercent,
      discountAmount,
    },
    req,
  });

  return {
    message: 'Đã tạo hóa đơn từ hợp đồng thành công',
    invoice,
    contract: {
      _id: contract._id,
      contractNumber: contract.contractNumber,
      discountPercent: contract.discountPercent,
    },
  };
};

module.exports = {
  createInvoiceFromContract,
};

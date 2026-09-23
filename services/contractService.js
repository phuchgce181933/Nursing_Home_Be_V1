const { Types } = require('mongoose');
const ServiceError = require('./serviceError');
const contractRepo = require('../repositories/contractRepository');
const admissionRepo = require('../repositories/admissionRepository');
const residentRepo = require('../repositories/residentRepository');
const servicePackageRepo = require('../repositories/servicePackageRepository');
const invoiceRepo = require('../repositories/invoiceRepository');
const bedRepo = require('../repositories/bedRepository');
const roomRepo = require('../repositories/roomRepository');
const walletService = require('./walletService');
const { createAuditLog } = require('../utils/auditLog');

// Helper: validate max length
const assertMaxLength = (value, fieldName, maxLength = 500) => {
  if (value !== undefined && value !== null && String(value).length > maxLength) {
    throw new ServiceError(`${fieldName} không được vượt quá ${maxLength} ký tự`, 400);
  }
};

// Helper: generate contract number
const generateContractNumber = () => {
  const year = new Date().getFullYear();
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `HD-${year}-${timestamp}-${random}`;
};

// Helper: calculate remaining months
const getRemainingContractMonths = (contract) => {
  const startDate = contract?.startDate ? new Date(contract.startDate) : null;
  const endDate = contract?.endDate ? new Date(contract.endDate) : null;
  if (!endDate) return 0;

  const now = new Date();
  const periodStart = startDate && startDate > now ? startDate : now;
  const remainingMs = endDate.getTime() - periodStart.getTime();
  if (remainingMs <= 0) return 0;

  const remainingDays = remainingMs / (1000 * 60 * 60 * 24);
  return Math.max(0, remainingDays / 30);
};

// ── UC-210: Create Contract ───────────────────────────────────────────────────
const createContract = async (admin, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  }

  // Chỉ cho phép tạo hợp đồng khi Đánh giá y tế đã đạt "Đủ điều kiện".
  // Nếu đang "Chờ đánh giá" (pending) hoặc "Không đủ điều kiện" (not_eligible)
  // thì phải hoàn tất đánh giá trước khi ký hợp đồng.
  if (admission.eligibilityStatus !== 'eligible') {
    const eligibilityLabel = {
      pending: 'Chờ đánh giá',
      not_eligible: 'Không đủ điều kiện',
    }[admission.eligibilityStatus] || admission.eligibilityStatus || 'chưa xác định';
    throw new ServiceError(
      `Không thể tạo hợp đồng khi Đánh giá y tế đang ở trạng thái "${eligibilityLabel}". Chỉ tạo được khi Đánh giá y tế đạt "Đủ điều kiện".`,
      400
    );
  }

  // Cho phép tạo hợp đồng từ các trạng thái hợp lệ trước khi nhập viện thực sự.
  //   - new_request: yêu cầu mới (chưa qua tư vấn)
  //   - consulting: đang tư vấn
  //   - assessing: đang đánh giá (nhưng đã đủ điều kiện → đã có thể ký HĐ)
  //   - contracting: đang trong quá trình tạo HĐ
  // Chặn các trạng thái terminal:
  //   - checked_in: cư dân đã được tiếp nhận (đã có hợp đồng active hoặc gia hạn)
  //   - cancelled: yêu cầu nhập viện đã bị hủy
  if (!['new_request', 'consulting', 'assessing', 'contracting'].includes(admission.status)) {
    throw new ServiceError(
      `Không thể tạo hợp đồng cho yêu cầu nhập viện với trạng thái: ${admission.status}. Hợp đồng phải được tạo trước khi cư dân được tiếp nhận hoặc yêu cầu bị hủy.`,
      400
    );
  }

  // Check if already has active contract
  const existingContract = await contractRepo.findActiveByAdmissionId(admissionId);
  if (existingContract) {
    throw new ServiceError('Hồ sơ này đã có hợp đồng đang hoạt động. Không thể tạo hợp đồng mới.', 409);
  }

  // Contract number
  let contractNumber = body?.contractNumber?.trim();
  if (!contractNumber) {
    contractNumber = generateContractNumber();
  } else {
    // Check for duplicate contract number
    const duplicate = await contractRepo.findByContractNumber(contractNumber);
    if (duplicate) {
      throw new ServiceError(`Số hợp đồng '${contractNumber}' đã tồn tại.`, 409);
    }
  }

  // Parse dates
  const startDate = body?.startDate ? new Date(body.startDate) : null;
  const endDate = body?.endDate ? new Date(body.endDate) : null;
  const durationMonths = body?.durationMonths !== undefined && body.durationMonths !== null
    ? Number(body.durationMonths)
    : undefined;
  const discountPercent = body?.discountPercent !== undefined && body?.discountPercent !== null
    ? Number(body.discountPercent)
    : undefined;

  // Parse payment plan (FULL | HALF_NOW | MONTHLY)
  const paymentPlanRaw = String(body?.paymentPlan || 'MONTHLY').toUpperCase();
  const paymentPlan = ['FULL', 'HALF_NOW', 'MONTHLY'].includes(paymentPlanRaw)
    ? paymentPlanRaw
    : 'MONTHLY';

  // Parse room/bed assignment (ưu tiên từ body khi staff chọn phòng/giường ngay khi tạo hợp đồng,
  // fallback về admission.assignedRoomId/assignedBedId nếu có)
  const roomId = body?.roomId || admission.assignedRoomId || null;
  const bedId = body?.bedId || admission.assignedBedId || null;

  // Validate dates
  if (startDate && Number.isNaN(startDate.getTime())) {
    throw new ServiceError('startDate không hợp lệ', 400);
  }
  if (endDate && Number.isNaN(endDate.getTime())) {
    throw new ServiceError('endDate không hợp lệ', 400);
  }
  if (startDate && endDate && endDate <= startDate) {
    throw new ServiceError('endDate phải sau startDate', 400);
  }
  if (startDate && endDate) {
    const minimumEndDate = new Date(startDate);
    minimumEndDate.setDate(minimumEndDate.getDate() + 30);
    if (endDate < minimumEndDate) {
      throw new ServiceError('Ngày kết thúc hợp đồng phải cách ngày bắt đầu ít nhất 30 ngày.', 400);
    }
  }

  // Validate duration
  if (durationMonths !== undefined) {
    if (!Number.isFinite(durationMonths) || durationMonths < 1) {
      throw new ServiceError('durationMonths phải là số dương', 400);
    }
  }

  // Validate discount
  if (discountPercent !== undefined) {
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      throw new ServiceError('discountPercent phải là số trong khoảng từ 0 đến 100', 400);
    }
  }

  // Validate terms and notes
  assertMaxLength(body?.terms?.trim(), 'terms', 50000);
  assertMaxLength(body?.notes?.trim(), 'notes');

  // Resolve service package: ưu tiên body.servicePackageId (admin chọn trực tiếp
  // khi tạo hợp đồng), fallback về admission.servicePackageId. Cho phép tạo hợp
  // đồng ngay cả khi admission chưa gán gói dịch vụ — miễn là admin chọn được
  // gói qua dropdown trên UI.
  let resolvedServicePackageId = body?.servicePackageId || admission.servicePackageId || null;
  if (resolvedServicePackageId && typeof resolvedServicePackageId === 'string'
      && !Types.ObjectId.isValid(resolvedServicePackageId)) {
    throw new ServiceError('servicePackageId không hợp lệ', 400);
  }
  if (resolvedServicePackageId) {
    resolvedServicePackageId = new Types.ObjectId(String(resolvedServicePackageId));
  }

  // Get service package info
  let monthlyFee = 0;
  if (resolvedServicePackageId) {
    const pkg = await servicePackageRepo.findById(resolvedServicePackageId);
    if (!pkg) {
      throw new ServiceError('Không tìm thấy gói dịch vụ đã chọn', 404);
    }
    if (!pkg.isActive) {
      throw new ServiceError(`Gói dịch vụ "${pkg.name}" hiện đang ngừng hoạt động, không thể gán cho hợp đồng`, 400);
    }
    monthlyFee = Number(pkg.monthlyPrice) || 0;
  } else if (!body?.servicePackageId && !admission.servicePackageId) {
    // Cả admission lẫn body đều không có gói dịch vụ — bắt buộc phải chọn.
    throw new ServiceError(
      'Vui lòng chọn gói dịch vụ cho hợp đồng (yêu cầu nhập viện chưa gán gói dịch vụ).',
      400
    );
  }

  // ── Validate bed availability trước khi tạo hợp đồng ──
  // Ngăn chặn 2 trường hợp: (1) admin chọn giường đã có cư dân khác, (2) race
  // condition giữa lúc chọn giường trên UI và lúc submit xuống backend.
  let bedAssignment = null;
  if (bedId) {
    bedAssignment = await bedRepo.findById(bedId);
    if (!bedAssignment) {
      throw new ServiceError(`Không tìm thấy giường "${bedId}"`, 404);
    }
    // Bỏ qua validate nếu giường này đã được gán cho chính cư dân của admission
    // hiện tại (idempotent — admin mở lại modal không bị lỗi).
    const isAlreadyAssignedToSameResident =
      bedAssignment.assignedResidentId
      && String(bedAssignment.assignedResidentId) === String(admission.residentId);
    if (!isAlreadyAssignedToSameResident) {
      if (bedAssignment.status && bedAssignment.status !== 'available') {
        const statusVi = {
          occupied: 'đã có người',
          reserved: 'đã được đặt trước',
          maintenance: 'đang bảo trì',
        }[bedAssignment.status] || bedAssignment.status;
        throw new ServiceError(
          `Giường "${bedAssignment.bedCode}" hiện ${statusVi} — không thể gán cho hợp đồng này. Vui lòng chọn giường khác.`,
          400
        );
      }
      if (bedAssignment.assignedResidentId
          && String(bedAssignment.assignedResidentId) !== String(admission.residentId)) {
        throw new ServiceError(
          `Giường "${bedAssignment.bedCode}" đã được gán cho cư dân khác — không thể gán cho hợp đồng này.`,
          400
        );
      }
    }
  }

  // ── Validate room còn chỗ trống (nếu có chọn phòng) ──
  if (roomId) {
    const room = await roomRepo.findByIdDoc(roomId);
    if (!room) {
      throw new ServiceError(`Không tìm thấy phòng "${roomId}"`, 404);
    }
    if (room.status === 'closed' || room.status === 'maintenance') {
      throw new ServiceError(
        `Phòng "${room.roomNumber}" hiện ${room.status === 'closed' ? 'đã đóng' : 'đang bảo trì'} — không thể gán.`,
        400
      );
    }
    if (room.capacity > 0 && (room.occupiedCount || 0) >= room.capacity && !bedAssignment) {
      throw new ServiceError(
        `Phòng "${room.roomNumber}" đã đầy (${room.occupiedCount}/${room.capacity} giường). Vui lòng chọn phòng khác hoặc chọn giường cụ thể trong phòng.`,
        400
      );
    }
  }

  // Create contract
  const contractData = {
    contractNumber,
    admissionId: admission._id,
    residentId: admission.residentId,
    familyAccountId: admission.familyAccountId,
    servicePackageId: resolvedServicePackageId,
    signedAt: new Date(),
    startDate: startDate || new Date(),
    endDate,
    durationMonths: durationMonths ? Math.floor(durationMonths) : undefined,
    discountPercent: discountPercent !== undefined ? Math.round(discountPercent * 100) / 100 : 0,
    monthlyFee,
    paymentPlan,
    terms: body?.terms?.trim(),
    notes: body?.notes?.trim(),
    status: 'active',
    createdBy: admin._id,
    // Room/Bed assignment - ưu tiên từ body (form chọn phòng/giường), fallback admission
    ...(roomId && { roomId }),
    ...(bedId && { bedId }),
  };

  const contract = await contractRepo.create(contractData);

  // Calculate duration in months
  let invoiceCount = contract.durationMonths || 12;
  
  // If no durationMonths but has startDate and endDate, calculate from dates
  if (!contract.durationMonths && contract.startDate && contract.endDate) {
    const start = new Date(contract.startDate);
    const end = new Date(contract.endDate);
    let months = (end.getFullYear() - start.getFullYear()) * 12;
    months += end.getMonth() - start.getMonth();
    // Add 1 if end day >= start day (inclusive month calculation)
    if (end.getDate() >= start.getDate()) months += 1;
    invoiceCount = Math.max(1, months);
  }

  const monthlyFeeAfterDiscount = monthlyFee * (1 - (contract.discountPercent / 100));

  // Determine per-invoice amount based on the contract's paymentPlan.
  //   FULL      → mỗi hóa đơn tháng giữ nguyên 100% phí (thanh toán tất cả các tháng)
  //   HALF_NOW  → mỗi hóa đơn tháng chỉ ghi 50%, phần còn lại lưu remainingAmount
  //   MONTHLY   → mỗi hóa đơn tháng ghi đủ 100%, thanh toán theo từng tháng
  // Hóa đơn luôn khởi tạo ở trạng thái 'DRAFT' (chưa xuất) — chỉ Admin thấy,
  // gia đình chỉ thấy sau khi Admin bấm "Xuất hóa đơn" (flip DRAFT → ISSUED).
  const invoiceAmountFactor = paymentPlan === 'HALF_NOW' ? 0.5 : 1;
  const perInvoiceGross = Math.round(monthlyFeeAfterDiscount * invoiceAmountFactor);
  const perInvoiceOriginalGross = paymentPlan === 'HALF_NOW' ? monthlyFee : monthlyFee;
  const perInvoiceRemainingFactor = paymentPlan === 'HALF_NOW' ? 0.5 : 0;

  for (let i = 0; i < invoiceCount; i++) {
    const periodStart = new Date(contract.startDate);
    periodStart.setMonth(periodStart.getMonth() + i);
    periodStart.setDate(1);

    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setDate(0); // Last day of month

    // Invoice number format: HD-YYYYMMDD-XXX (XXX = sequential number)
    const invoiceNumber = `HD-${contract.contractNumber}-${String(i + 1).padStart(3, '0')}`;

    const invoiceData = {
      invoiceNumber,
      residentId: contract.residentId,
      contractId: contract._id,
      admissionId: contract.admissionId,
      familyAccountId: contract.familyAccountId,
      // Hóa đơn khởi tạo ở trạng thái DRAFT = "chưa xuất" — chỉ Admin thấy.
      // Admin sẽ chuyển sang ISSUED sau khi sẵn sàng công khai cho gia đình.
      status: 'DRAFT',
      type: 'SERVICE',
      paymentPlan,
      periodStart,
      periodEnd,
      billingPeriodStart: periodStart,
      billingPeriodEnd: periodEnd,
      // Hạn thanh toán: khi xuất (DRAFT→ISSUED) sẽ được set lại = issuedAt + 5 ngày.
      // Lúc khởi tạo hóa đơn Nháp, tạm thời để trống (null) — đợi ngày xuất mới biết.
      dueDate: null,
      careServiceCost: perInvoiceGross,
      total: perInvoiceGross,
      totalAmount: perInvoiceGross,
      // HALF_NOW: 50% còn lại được ghi nhận remaining; FULL/MONTHLY: 0 (đã bao gồm trong totalAmount)
      remainingAmount: Math.round(monthlyFeeAfterDiscount * perInvoiceRemainingFactor),
      originalTotalAmount: perInvoiceOriginalGross,
      subTotal: perInvoiceGross,
      createdBy: admin._id?.toString(),
    };

    await invoiceRepo.create(invoiceData);
  }

  // Update resident status to 'admitted' and assign room/bed
  const residentUpdate = {
    residencyStatus: 'admitted',
    admittedAt: new Date(),
  };
  if (roomId) residentUpdate.roomId = roomId;
  if (bedId) residentUpdate.bedId = bedId;
  await residentRepo.updateById(admission.residentId, residentUpdate);

  // ── Occupy bed + tăng room.occupiedCount (nếu có chọn giường) ──
  // Thực hiện SAU khi resident/admission đã được cập nhật để tránh trạng thái
  // "bed occupied" nhưng resident chưa có bedId.
  // Bỏ qua nếu giường đã được gán cho chính cư dân này trước đó (idempotent).
  if (bedId && bedAssignment) {
    const alreadyAssignedToThisResident =
      bedAssignment.assignedResidentId
      && String(bedAssignment.assignedResidentId) === String(admission.residentId);
    if (!alreadyAssignedToThisResident) {
      await bedRepo.occupyBed(bedId, admission.residentId, new Date());
      // Tăng occupiedCount của phòng (chỉ khi đây là lần gán mới)
      if (roomId) {
        try {
          await roomRepo.adjustOccupiedCount(roomId, 1);
        } catch (roomErr) {
          console.error('[createContractFromAdmission] adjustOccupiedCount failed:', roomErr.message);
          // Không rollback — bed đã được occupy, room sẽ được sync sau qua syncAllRoomOccupancy
        }
      }
    }
  }

  // Update admission status to 'checked_in' (Đã tiếp nhận).
  // Sau khi hợp đồng được ký, cư dân chính thức được tiếp nhận vào viện —
  // không cần qua bước check-in riêng (phòng/giường có thể phân bổ sau).
  const admissionUpdate = {
    status: 'checked_in',
    checkInAt: new Date(),
    contractNumber: contract.contractNumber,
    contractStartDate: contract.startDate,
    contractEndDate: contract.endDate,
    contractDurationMonths: contract.durationMonths,
    contractDiscountPercent: contract.discountPercent,
    contractStatus: 'active',
    contractSignedAt: contract.signedAt,
    contractTerms: contract.terms,
    // Lưu phòng/giường vào admission để tham chiếu sau này
    ...(roomId && { assignedRoomId: roomId }),
    ...(bedId && { assignedBedId: bedId }),
    // Đồng bộ gói dịch vụ lên admission nếu admin chọn gói khác khi tạo hợp đồng
    ...(resolvedServicePackageId && { servicePackageId: resolvedServicePackageId }),
  };
  await admissionRepo.updateAdmission(admissionId, admissionUpdate);

  // Create audit log
  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'CREATE_CONTRACT',
    module: 'contract',
    targetEntityType: 'Contract',
    targetEntityId: contract._id,
    beforeData: {
      admissionId: admission._id,
      requestCode: admission.requestCode,
      status: admission.status,
    },
    afterData: {
      contractId: contract._id,
      contractNumber: contract.contractNumber,
      startDate: contract.startDate,
      endDate: contract.endDate,
      durationMonths: contract.durationMonths,
      discountPercent: contract.discountPercent,
      paymentPlan: contract.paymentPlan,
      invoiceCount,
      status: contract.status,
    },
    req,
  });

  return {
    message: 'Đã tạo hợp đồng thành công',
    contract,
  };
};

// ── UC-211: View Contract List ─────────────────────────────────────────────────
const listContracts = async (query, user) => {
  const filter = {};
  
  // Status filter
  if (query.status) {
    const statuses = query.status.split(',').map(s => s.trim());
    filter.status = { $in: statuses };
  }
  
  // Search by contract number or resident name
  if (query.search) {
    filter.$or = [
      { contractNumber: { $regex: query.search, $options: 'i' } },
    ];
  }
  
  // Filter by admissionId
  if (query.admissionId) {
    filter.admissionId = query.admissionId;
  }
  
  // Filter by residentId
  if (query.residentId) {
    filter.residentId = query.residentId;
  }

  // Pagination
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;

  const [contracts, total] = await Promise.all([
    contractRepo.findAll(filter, {
      sort: { createdAt: -1 },
      skip,
      limit: limitNum,
      // Dùng lean() để trả về plain object thay vì Mongoose Document.
      // Nếu dùng Mongoose Document, spread `...contract` sẽ trả về internal
      // properties ($__, populated, ...) thay vì các field thực tế, khiến
      // frontend không đọc được contractNumber, residentId, startDate, endDate...
      lean: true,
      // Populate đầy đủ thông tin cần thiết để frontend không phải fetch lại:
      //   admissionId  → thông tin yêu cầu nhập viện
      //   residentId   → hồ sơ người cao tuổi (fullName, residentCode, residencyStatus, ...)
      //   servicePackageId → gói dịch vụ (name, monthlyPrice, ...)
      // Dùng object syntax để chỉ rõ các field cần populate nhằm tránh payload quá lớn
      // và đảm bảo các field luôn có mặt (tránh residentName/contractNumber bị rỗng).
      populate: [
        { path: 'admissionId', select: '_id status applicant assignedServicePackage contractNumber' },
        { path: 'residentId', select: '_id residentCode fullName dateOfBirth gender residencyStatus avatarUrl' },
        { path: 'servicePackageId', select: '_id name monthlyPrice tier roomType' },
      ],
    }),
    contractRepo.countAll(filter),
  ]);

  // Đính kèm invoice summary cho mỗi hợp đồng để admin biết:
  // - Có bao nhiêu hóa đơn đang ở trạng thái DRAFT (chưa xuất)
  // - Hóa đơn mới nhất
  // - Tổng tiền còn phải thu
  const contractIds = contracts.map((c) => c._id);
  let invoiceAgg = [];
  if (contractIds.length > 0) {
    invoiceAgg = await invoiceRepo.aggregate([
      { $match: { contractId: { $in: contractIds } } },
      {
        $group: {
          _id: '$contractId',
          draftCount: { $sum: { $cond: [{ $eq: ['$status', 'DRAFT'] }, 1, 0] } },
          issuedCount: { $sum: { $cond: [{ $eq: ['$status', 'ISSUED'] }, 1, 0] } },
          paidCount: { $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, 1, 0] } },
          totalCount: { $sum: 1 },
          outstandingAmount: {
            $sum: {
              $cond: [
                { $in: ['$status', ['DRAFT', 'ISSUED', 'PARTIALLY_PAID']] },
                { $ifNull: ['$remainingAmount', '$totalAmount'] },
                0,
              ],
            },
          },
          latestInvoice: { $first: '$$ROOT' },
        },
      },
    ]);
  }

  const invoiceMap = new Map();
  for (const agg of invoiceAgg) {
    invoiceMap.set(String(agg._id), agg);
  }

  const data = contracts.map((contract) => {
    const summary = invoiceMap.get(String(contract._id));
    if (!summary) {
      return {
        ...contract,
        invoiceSummary: { draftCount: 0, issuedCount: 0, paidCount: 0, totalCount: 0, outstandingAmount: 0 },
        latestInvoice: null,
      };
    }
    const latest = summary.latestInvoice || null;
    return {
      ...contract,
      invoiceSummary: {
        draftCount: summary.draftCount,
        issuedCount: summary.issuedCount,
        paidCount: summary.paidCount,
        totalCount: summary.totalCount,
        outstandingAmount: summary.outstandingAmount,
      },
      latestInvoice: latest,
    };
  });

  return {
    data,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.max(Math.ceil(total / limitNum), 1),
  };
};

// ── UC-212: View Contract Details ─────────────────────────────────────────────
const getContractDetails = async (contractId, user) => {
  const contract = await contractRepo.findById(contractId);
  if (!contract) {
    throw new ServiceError('Không tìm thấy hợp đồng', 404);
  }

  // Get related invoices
  const invoices = await invoiceRepo.findAll(
    { contractId: contract._id },
    { sort: { createdAt: -1 }, limit: 50 }
  );

  // Calculate outstanding amount
  let outstandingAmount = 0;
  for (const invoice of invoices) {
    if (['DRAFT', 'ISSUED', 'PARTIALLY_PAID'].includes(invoice.status)) {
      outstandingAmount += invoice.totalAmount || 0;
    }
  }

  return {
    contract,
    invoices,
    outstandingAmount,
  };
};

// ── UC-213: Renew Contract ────────────────────────────────────────────────────
const renewContract = async (admin, contractId, body, req) => {
  const existingContract = await contractRepo.findById(contractId);
  if (!existingContract) {
    throw new ServiceError('Không tìm thấy hợp đồng', 404);
  }

  if (existingContract.status === 'cancelled' || existingContract.status === 'terminated') {
    throw new ServiceError('Không thể gia hạn hợp đồng đã bị hủy hoặc chấm dứt.', 400);
  }

  const { startDate, endDate, servicePackageId, durationMonths, discountPercent } = body;

  // Validate new dates
  const newStartDate = startDate ? new Date(startDate) : new Date();
  const newEndDate = endDate ? new Date(endDate) : null;

  if (newStartDate && Number.isNaN(newStartDate.getTime())) {
    throw new ServiceError('startDate không hợp lệ', 400);
  }
  if (newEndDate && Number.isNaN(newEndDate.getTime())) {
    throw new ServiceError('endDate không hợp lệ', 400);
  }
  if (newEndDate && newEndDate <= newStartDate) {
    throw new ServiceError('endDate phải sau startDate', 400);
  }

  // Validate duration
  const newDurationMonths = durationMonths !== undefined && durationMonths !== null
    ? Number(durationMonths)
    : undefined;
  if (newDurationMonths !== undefined && (!Number.isFinite(newDurationMonths) || newDurationMonths < 1)) {
    throw new ServiceError('durationMonths phải là số dương', 400);
  }

  // Validate discount
  const newDiscountPercent = discountPercent !== undefined && discountPercent !== null
    ? Number(discountPercent)
    : existingContract.discountPercent;
  if (newDiscountPercent < 0 || newDiscountPercent > 100) {
    throw new ServiceError('discountPercent phải trong khoảng từ 0 đến 100', 400);
  }

  // Get service package
  let servicePkg = null;
  if (servicePackageId) {
    servicePkg = await servicePackageRepo.findById(servicePackageId);
    if (!servicePkg) {
      throw new ServiceError('Không tìm thấy gói dịch vụ', 404);
    }
    if (!servicePkg.isActive) {
      throw new ServiceError('Gói dịch vụ không còn hoạt động', 400);
    }
  } else if (existingContract.servicePackageId) {
    servicePkg = await servicePackageRepo.findById(existingContract.servicePackageId);
  }

  // Mark old contract as expired
  await contractRepo.updateById(existingContract._id, {
    status: 'expired',
  });

  // Create new contract
  const newContractNumber = generateContractNumber();
  // Payment plan: gia hạn giữ nguyên hình thức thanh toán của HĐ cũ (hoặc cho phép override).
  const renewPaymentPlanRaw = String(body?.paymentPlan || existingContract.paymentPlan || 'MONTHLY').toUpperCase();
  const renewPaymentPlan = ['FULL', 'HALF_NOW', 'MONTHLY'].includes(renewPaymentPlanRaw)
    ? renewPaymentPlanRaw
    : (existingContract.paymentPlan || 'MONTHLY');

  const newContract = await contractRepo.create({
    contractNumber: newContractNumber,
    admissionId: existingContract.admissionId,
    residentId: existingContract.residentId,
    familyAccountId: existingContract.familyAccountId,
    servicePackageId: servicePackageId || existingContract.servicePackageId,
    signedAt: new Date(),
    startDate: newStartDate,
    endDate: newEndDate,
    durationMonths: newDurationMonths ? Math.floor(newDurationMonths) : existingContract.durationMonths,
    discountPercent: newDiscountPercent,
    monthlyFee: servicePkg ? Number(servicePkg.monthlyPrice) || 0 : existingContract.monthlyFee,
    paymentPlan: renewPaymentPlan,
    terms: body?.terms?.trim() || existingContract.terms,
    notes: body?.notes?.trim(),
    status: 'active',
    previousContractId: existingContract._id,
    isRenewal: true,
    createdBy: admin._id,
  });

  // Update admission with new contract info.
  // Cư dân đã được tiếp nhận trước đó, chỉ gia hạn hợp đồng → giữ 'checked_in'.
  await admissionRepo.updateAdmission(existingContract.admissionId, {
    status: 'checked_in',
    contractNumber: newContract.contractNumber,
    contractStartDate: newContract.startDate,
    contractEndDate: newContract.endDate,
    contractDurationMonths: newContract.durationMonths,
    contractDiscountPercent: newContract.discountPercent,
    contractStatus: 'active',
    contractSignedAt: newContract.signedAt,
    servicePackageId: servicePackageId || existingContract.servicePackageId,
  });

  // Audit log for old contract
  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'RENEW_CONTRACT',
    module: 'contract',
    targetEntityType: 'Contract',
    targetEntityId: existingContract._id,
    beforeData: { status: existingContract.status, endDate: existingContract.endDate },
    afterData: { status: 'expired', replacedBy: newContract._id },
    req,
  });

  // Audit log for new contract
  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'CREATE_CONTRACT',
    module: 'contract',
    targetEntityType: 'Contract',
    targetEntityId: newContract._id,
    beforeData: { admissionId: existingContract.admissionId },
    afterData: {
      contractNumber: newContract.contractNumber,
      startDate: newContract.startDate,
      endDate: newContract.endDate,
      durationMonths: newContract.durationMonths,
      discountPercent: newContract.discountPercent,
      isRenewal: true,
      previousContractId: existingContract._id,
    },
    req,
  });

  return {
    message: 'Đã gia hạn hợp đồng thành công',
    oldContract: { _id: existingContract._id, status: 'expired' },
    newContract,
  };
};

// ── UC-214: Terminate Contract ─────────────────────────────────────────────────
const terminateContract = async (admin, contractId, body, req) => {
  const contract = await contractRepo.findById(contractId);
  if (!contract) {
    throw new ServiceError('Không tìm thấy hợp đồng', 404);
  }

  if (contract.status === 'cancelled' || contract.status === 'terminated') {
    throw new ServiceError('Hợp đồng đã bị hủy hoặc chấm dứt.', 400);
  }

  const cancellationReason = String(body?.reason || body?.cancellationReason || '').trim();
  if (!cancellationReason) {
    throw new ServiceError('Vui lòng nhập lý do chấm dứt hợp đồng.', 400);
  }

  // Update contract status
  const updatedContract = await contractRepo.updateById(contract._id, {
    status: 'terminated',
    cancelledAt: new Date(),
    cancellationReason,
    cancelledBy: admin._id,
  });

  // Update admission - reset to allow new contract
  await admissionRepo.updateAdmission(contract.admissionId, {
    status: 'new_request',
    contractStatus: 'cancelled',
    contractCancelledAt: new Date(),
    contractCancellationReason: cancellationReason,
  });

  // Cancel pending invoices
  const pendingInvoices = await invoiceRepo.findAll({
    contractId: contract._id,
    status: { $in: ['DRAFT', 'ISSUED'] },
  });
  for (const invoice of pendingInvoices) {
    await invoiceRepo.updateById(invoice._id, {
      status: 'CANCELLED',
      cancellationReason: 'Hợp đồng đã bị chấm dứt.',
    });
  }

  // Audit log
  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'TERMINATE_CONTRACT',
    module: 'contract',
    targetEntityType: 'Contract',
    targetEntityId: contract._id,
    beforeData: {
      contractNumber: contract.contractNumber,
      status: contract.status,
    },
    afterData: {
      contractNumber: contract.contractNumber,
      status: 'terminated',
      cancellationReason,
    },
    req,
  });

  return {
    message: 'Đã chấm dứt hợp đồng thành công',
    contract: updatedContract,
  };
};

// ── UC-215: View Contract History ──────────────────────────────────────────────
const getContractHistory = async (admissionId, query) => {
  // Get all contracts for this admission
  const contracts = await contractRepo.findByAdmissionId(admissionId);

  // Get all invoices for this admission
  const invoices = await invoiceRepo.findAll(
    { admissionId: new Types.ObjectId(admissionId) },
    { sort: { createdAt: -1 }, limit: 100 }
  );

  return {
    contracts,
    invoices,
  };
};

// ── Issue Invoices (Admin flips DRAFT → ISSUED for a whole contract) ───────────
// Hợp đồng khi mới tạo sẽ sinh ra các hóa đơn ở trạng thái DRAFT (chưa xuất) —
// chỉ Admin thấy, gia đình chưa thấy. Khi Admin sẵn sàng xuất, gọi endpoint
// này để chuyển tất cả hóa đơn DRAFT của hợp đồng sang ISSUED (đã xuất) —
// gia đình sẽ thấy và thanh toán được.
//
// Optional body.invoiceIds: nếu truyền lên thì chỉ xuất các hóa đơn này.
// Nếu không truyền thì xuất tất cả DRAFT của hợp đồng.
const issueInvoices = async (admin, contractId, body = {}, req) => {
  const contract = await contractRepo.findById(contractId);
  if (!contract) {
    throw new ServiceError('Không tìm thấy hợp đồng', 404);
  }

  // Chỉ xuất hóa đơn cho hợp đồng đang active
  if (contract.status !== 'active') {
    throw new ServiceError(
      `Không thể xuất hóa đơn cho hợp đồng với trạng thái: ${contract.status}. Chỉ cho phép: active.`,
      400
    );
  }

  const filter = { contractId: contract._id, status: 'DRAFT' };
  if (Array.isArray(body.invoiceIds) && body.invoiceIds.length > 0) {
    filter._id = { $in: body.invoiceIds };
  }

  const draftInvoices = await invoiceRepo.findAll(filter, { limit: 100 });
  if (draftInvoices.length === 0) {
    throw new ServiceError('Không có hóa đơn DRAFT nào để xuất.', 400);
  }

  const issuedAt = new Date();
  const updatedIds = [];
  for (const inv of draftInvoices) {
    // Hạn thanh toán = ngày bắt đầu kỳ thanh toán + 5 ngày.
    // Dùng billingPeriodStart (Từ) chứ không phải ngày xuất, để gia đình có
    // thời gian thanh toán ngay từ đầu kỳ.
    const periodStart = inv.billingPeriodStart || inv.periodStart || issuedAt;
    const dueDate = new Date(new Date(periodStart).getTime() + 5 * 24 * 60 * 60 * 1000);
    await invoiceRepo.updateById(inv._id, {
      status: 'ISSUED',
      issuedAt,
      dueDate,
    });
    updatedIds.push(inv._id);
  }

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'ISSUE_INVOICES',
    module: 'contract',
    targetEntityType: 'Contract',
    targetEntityId: contract._id,
    beforeData: {
      contractNumber: contract.contractNumber,
      draftInvoiceCount: draftInvoices.length,
    },
    afterData: {
      contractNumber: contract.contractNumber,
      issuedInvoiceIds: updatedIds,
      issuedAt,
    },
    req,
  });

  return {
    message: `Đã xuất ${updatedIds.length} hóa đơn cho hợp đồng ${contract.contractNumber}.`,
    contractId: contract._id,
    contractNumber: contract.contractNumber,
    issuedCount: updatedIds.length,
    issuedInvoiceIds: updatedIds,
  };
};

// ── Recalculate DRAFT invoice prices for a contract ───────────────────────────
// Một số hợp đồng cũ được tạo khi service package chưa có monthlyPrice (do dữ
// liệu cũ hoặc seed thiếu), khiến các hóa đơn DRAFT sinh ra có totalAmount = 0.
// Endpoint này cho phép admin "tính lại" các hóa đơn DRAFT của hợp đồng dựa trên
// monthlyFee hiện tại của hợp đồng (ưu tiên lấy lại từ service package nếu giá
// hiện tại > 0).
//
// Chỉ áp dụng cho hóa đơn DRAFT — hóa đơn đã xuất (ISSUED/PAID/...) không bị
// động vào để tránh sai lệch dữ liệu tài chính đã phát hành.
const recalculateContractInvoices = async (admin, contractId, req) => {
  const contract = await contractRepo.findByIdLean(contractId);
  if (!contract) {
    throw new ServiceError('Không tìm thấy hợp đồng', 404);
  }

  // Ưu tiên monthlyFee từ service package (giá hiện tại) nếu > 0,
  // fallback về monthlyFee đã lưu trên hợp đồng.
  let monthlyFee = Number(contract.monthlyFee) || 0;
  if (contract.servicePackageId) {
    const pkg = await servicePackageRepo.findById(contract.servicePackageId);
    if (pkg && Number(pkg.monthlyPrice) > 0) {
      monthlyFee = Number(pkg.monthlyPrice);
    }
  }
  if (monthlyFee <= 0) {
    throw new ServiceError(
      'Không thể tính lại: hợp đồng và gói dịch vụ đều chưa có đơn giá (monthlyPrice = 0). Vui lòng cập nhật giá gói dịch vụ trước.',
      400
    );
  }

  const paymentPlan = String(contract.paymentPlan || 'MONTHLY').toUpperCase();
  const discountPercent = Number(contract.discountPercent) || 0;
  const monthlyFeeAfterDiscount = monthlyFee * (1 - discountPercent / 100);
  const invoiceAmountFactor = paymentPlan === 'HALF_NOW' ? 0.5 : 1;
  const perInvoiceGross = Math.round(monthlyFeeAfterDiscount * invoiceAmountFactor);
  const perInvoiceRemainingFactor = paymentPlan === 'HALF_NOW' ? 0.5 : 0;
  const perInvoiceOriginalGross = monthlyFee;
  const perInvoiceRemaining = Math.round(monthlyFeeAfterDiscount * perInvoiceRemainingFactor);

  const draftInvoices = await invoiceRepo.findAll({
    contractId: contract._id,
    status: 'DRAFT',
  });

  if (draftInvoices.length === 0) {
    throw new ServiceError('Không có hóa đơn DRAFT nào để tính lại.', 400);
  }

  const updatedIds = [];
  const skipped = [];
  for (const inv of draftInvoices) {
    // Bỏ qua hóa đơn thuốc (type MEDICATION) — chỉ tính lại SERVICE/COMBINED/OTHER
    const invType = String(inv.type || '').toUpperCase();
    if (invType === 'MEDICATION' || invType === 'MEDICATIONS') {
      skipped.push({ _id: inv._id, reason: 'MEDICATION invoice — giữ nguyên' });
      continue;
    }

    await invoiceRepo.updateById(inv._id, {
      careServiceCost: perInvoiceGross,
      total: perInvoiceGross,
      totalAmount: perInvoiceGross,
      remainingAmount: perInvoiceRemaining,
      originalTotalAmount: perInvoiceOriginalGross,
      subTotal: perInvoiceGross,
    });
    updatedIds.push(inv._id);
  }

  // Cập nhật monthlyFee trên hợp đồng để đồng bộ
  if (Number(contract.monthlyFee) !== monthlyFee) {
    await contractRepo.updateById(contract._id, { monthlyFee });
  }

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'RECALCULATE_CONTRACT_INVOICES',
    module: 'contract',
    targetEntityType: 'Contract',
    targetEntityId: contract._id,
    beforeData: { monthlyFee: contract.monthlyFee, draftCount: draftInvoices.length },
    afterData: { monthlyFee, perInvoiceGross, updatedCount: updatedIds.length, skippedCount: skipped.length },
    req,
  });

  return {
    message: `Đã tính lại ${updatedIds.length} hóa đơn với đơn giá ${monthlyFee.toLocaleString('vi-VN')} VND/tháng${skipped.length > 0 ? ` (bỏ qua ${skipped.length} hóa đơn thuốc)` : ''}.`,
    contractId: contract._id,
    contractNumber: contract.contractNumber,
    monthlyFee,
    perInvoiceGross,
    perInvoiceRemaining,
    updatedCount: updatedIds.length,
    skippedCount: skipped.length,
    updatedInvoiceIds: updatedIds,
  };
};

// ════════════════════════════════════════════════════════════════════════
// Cập nhật giá cho một hóa đơn DRAFT (trước khi xuất)
// ════════════════════════════════════════════════════════════════════════

const toNonNegativeInt = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
};

const toDateOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d;
};

/**
 * Admin sửa một hóa đơn DRAFT trước khi xuất:
 *  - billingPeriodStart: thay đổi kỳ bắt đầu tính phí (đồng bộ cả periodStart legacy)
 *  - careServiceCost:    thay đổi phí dịch vụ chăm sóc (thành phần chính của hóa đơn)
 *
 * Sau khi cập nhật, server tự động tính lại subTotal/total/totalAmount/remainingAmount/
 * originalTotalAmount dựa trên careServiceCost mới.
 *
 * Chỉ cho phép khi status === 'DRAFT' (chưa xuất). Hóa đơn đã xuất không thể sửa qua
 * endpoint này để tránh ảnh hưởng đến dữ liệu đã phát hành cho gia đình.
 */
const updateDraftInvoicePrice = async (admin, invoiceId, body, req) => {
  const invoice = await invoiceRepo.findByIdLean(invoiceId);
  if (!invoice) {
    throw new ServiceError('Không tìm thấy hóa đơn', 404);
  }

  const status = String(invoice.status || '').toUpperCase();
  if (status !== 'DRAFT') {
    throw new ServiceError(
      `Chỉ có thể sửa hóa đơn khi còn ở trạng thái Nháp (DRAFT). Hóa đơn hiện tại đang ở trạng thái "${invoice.status}".`,
      400
    );
  }

  // Chuẩn hóa payload — chỉ nhận các field cho phép
  const patch = {};

  if (body.careServiceCost !== undefined && body.careServiceCost !== null && body.careServiceCost !== '') {
    patch.careServiceCost = toNonNegativeInt(body.careServiceCost);
  }

  if (body.billingPeriodStart !== undefined && body.billingPeriodStart !== null && body.billingPeriodStart !== '') {
    const d = toDateOrNull(body.billingPeriodStart);
    if (!d) {
      throw new ServiceError('Kỳ bắt đầu không hợp lệ.', 400);
    }
    patch.billingPeriodStart = d;
    patch.periodStart = d; // đồng bộ legacy field
  }

  // Bắt buộc có ít nhất 1 field để cập nhật
  if (Object.keys(patch).length === 0) {
    throw new ServiceError('Vui lòng cung cấp ít nhất một trường để cập nhật.', 400);
  }

  // Tính lại totals dựa trên careServiceCost
  const careServiceCost = patch.careServiceCost !== undefined
    ? patch.careServiceCost
    : Number(invoice.careServiceCost || 0);
  const roomCost = Number(invoice.roomCost || 0);
  const medicationCost = Number(invoice.medicationCost || 0);
  const otherCost = Number(invoice.otherCost || 0);

  // Nếu có items chi tiết thì ưu tiên subTotal từ items; nếu không, lấy từ tổng breakdown
  const hasItems = Array.isArray(invoice.items) && invoice.items.length > 0;
  const itemsSum = hasItems
    ? invoice.items.reduce((s, it) => s + Number(it.amount || 0), 0)
    : 0;
  const tax = Number(invoice.tax || 0);

  const subTotal = hasItems ? itemsSum : (careServiceCost + roomCost + medicationCost + otherCost);
  const total = subTotal + tax;

  const originalTotal = subTotal; // giá gốc = tổng breakdown hiện tại (chưa cộng thuế)
  const paid = Number(invoice.paidAmount || 0); // phòng khi sau này có payment
  const remainingAmount = Math.max(total - paid, 0);

  Object.assign(patch, {
    subTotal,
    total,
    totalAmount: total,
    originalTotalAmount: originalTotal,
    remainingAmount,
  });

  const beforeData = {
    careServiceCost: Number(invoice.careServiceCost || 0),
    billingPeriodStart: invoice.billingPeriodStart || invoice.periodStart || null,
    subTotal: Number(invoice.subTotal || 0),
    totalAmount: Number(invoice.totalAmount || 0),
    remainingAmount: Number(invoice.remainingAmount || 0),
  };

  await invoiceRepo.updateById(invoiceId, patch);

  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  assertMaxLength(reason, 'Lý do sửa', 500);

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'UPDATE_DRAFT_INVOICE',
    module: 'contract',
    targetEntityType: 'Invoice',
    targetEntityId: invoiceId,
    beforeData,
    afterData: { ...patch, reason },
    req,
  });

  return {
    message: 'Đã cập nhật hóa đơn Nháp.',
    invoiceId,
    before: beforeData,
    after: {
      careServiceCost,
      billingPeriodStart: patch.billingPeriodStart || (invoice.billingPeriodStart || invoice.periodStart || null),
      subTotal,
      total,
      totalAmount: total,
      remainingAmount,
    },
  };
};

// ════════════════════════════════════════════════════════════════════════
// Soft-delete hóa đơn DRAFT (xóa mềm trước khi xuất) — nút "Dừng"
// ════════════════════════════════════════════════════════════════════════

/**
 * Admin "Dừng" (xóa mềm) một hóa đơn đang ở trạng thái DRAFT.
 *  - Không xóa vật lý: chỉ set `deletedAt` + `deletedBy` để ẩn khỏi danh sách.
 *  - Sau khi ẩn, không thể sửa/xuất hóa đơn này nữa (status check guard).
 *  - Hóa đơn đã xuất (ISSUED/...) không cho phép xóa mềm để tránh ảnh hưởng
 *    tới dữ liệu đã phát hành.
 *  - Lưu audit log với action `SOFT_DELETE_DRAFT_INVOICE`.
 */
const softDeleteDraftInvoice = async (admin, invoiceId, body, req) => {
  const invoice = await invoiceRepo.findByIdLean(invoiceId);
  if (!invoice) {
    throw new ServiceError('Không tìm thấy hóa đơn', 404);
  }

  if (invoice.deletedAt) {
    throw new ServiceError('Hóa đơn này đã được dừng (xóa mềm) trước đó.', 400);
  }

  const status = String(invoice.status || '').toUpperCase();
  if (status !== 'DRAFT') {
    throw new ServiceError(
      `Chỉ có thể dừng hóa đơn khi còn ở trạng thái Nháp (DRAFT). Hóa đơn hiện tại đang ở trạng thái "${invoice.status}".`,
      400
    );
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  assertMaxLength(reason, 'Lý do dừng', 500);

  const deletedAt = new Date();
  await invoiceRepo.updateById(invoiceId, {
    deletedAt,
    deletedBy: admin._id,
    status: 'CANCELLED',
    cancellationReason: reason || 'Admin yêu cầu dừng (xóa mềm)',
  });

  // Lookup resident + contract để hiển thị thông tin đầy đủ trong audit log.
  const [resident, contract] = await Promise.all([
    invoice.residentId ? residentRepo.findById(invoice.residentId) : Promise.resolve(null),
    invoice.contractId ? contractRepo.findById(invoice.contractId) : Promise.resolve(null),
  ]);
  const residentName = resident?.fullName || null;
  const residentCode = resident?.residentCode || null;
  const contractNumber = contract?.contractNumber || null;
  const invoiceLabel = invoice.invoiceNumber || `Hóa đơn #${invoiceId}`;

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'SOFT_DELETE_DRAFT_INVOICE',
    displayAction: 'Dừng hóa đơn nháp',
    module: 'contract',
    businessModule: 'contract',
    targetEntityType: 'Invoice',
    targetEntityId: invoiceId,
    targetName: invoiceLabel,
    description: `${admin.fullName || admin.email || 'Quản trị viên'} đã dừng (xóa mềm) ${invoiceLabel}${residentName ? ` của cư dân ${residentName}` : ''}${contractNumber ? ` (hợp đồng ${contractNumber})` : ''}.${reason ? ` Lý do: ${reason}` : ''}`,
    beforeData: {
      status: invoice.status,
      deletedAt: invoice.deletedAt || null,
      invoiceNumber: invoice.invoiceNumber || null,
      type: invoice.type || null,
      totalAmount: Number(invoice.totalAmount || 0),
      residentId: invoice.residentId || null,
      residentName,
      residentCode,
      contractNumber,
    },
    afterData: {
      status: 'CANCELLED',
      deletedAt,
      deletedBy: admin.fullName || admin.email || String(admin._id),
      deletedById: admin._id,
      cancellationReason: reason || 'Admin yêu cầu dừng (xóa mềm)',
    },
    metadata: {
      event: 'soft_delete_draft_invoice',
      invoiceNumber: invoice.invoiceNumber || null,
      invoiceType: invoice.type || null,
      totalAmount: Number(invoice.totalAmount || 0),
      contractId: invoice.contractId || null,
      contractNumber,
      residentId: invoice.residentId || null,
      residentName,
      residentCode,
      reason,
    },
    req,
  });

  return {
    message: 'Đã dừng (xóa mềm) hóa đơn Nháp.',
    invoiceId,
    deletedAt,
  };
};

// ════════════════════════════════════════════════════════════════════════
// Chuyển trạng thái hóa đơn (Admin thủ công)
// ════════════════════════════════════════════════════════════════════════

// Bản đồ trạng thái hợp lệ: [currentStatus] → [allowed target statuses]
const INVOICE_TRANSITIONS = {
  DRAFT:            ['ISSUED', 'CANCELLED'],
  ISSUED:           ['DRAFT', 'PAID', 'CANCELLED'],
  PARTIALLY_PAID:   ['ISSUED', 'PAID'],
  PAID:             [],  // Paid invoices are final — no manual rollback
  CANCELLED:        ['DRAFT'], // restore cancelled
};

const STATUS_LABELS = {
  DRAFT:           'Nháp',
  ISSUED:          'Đã xuất',
  PARTIALLY_PAID:  'Thanh toán một phần',
  PAID:            'Đã thanh toán',
  CANCELLED:       'Đã hủy',
};

/**
 * Admin chuyển trạng thái hóa đơn.
 *
 * Mỗi bước chuyển tự động cập nhật các field phụ thuộc:
 *  - DRAFT → ISSUED  : set issuedAt (now), dueDate (billingPeriodStart + 5 days)
 *  - ISSUED → DRAFT : clear issuedAt, dueDate (thu hồi khỏi family)
 *  - ISSUED → PAID   : set paidAt (now), remainingAmount = 0
 *  - ISSUED → CANCELLED: set cancellationReason, cancellationDate
 *  - PARTIALLY_PAID → ISSUED: clear paidAt, restore remainingAmount
 *  - PARTIALLY_PAID → PAID: set paidAt, remainingAmount = 0
 *  - CANCELLED → DRAFT: clear cancellationReason, cancellationDate
 *
 * Hóa đơn CANCELLED đã bị xóa mềm (deletedAt) không thể chuyển trạng thái.
 * Hóa đơn PAID không có bước chuyển nào (final state).
 */
const transitionInvoiceStatus = async (admin, invoiceId, body, req) => {
  console.log('🔄 [TRANSITION_INVOICE] called', {
    invoiceId,
    body,
    adminId: admin?._id?.toString(),
    adminRole: admin?.role,
  });
  const { status: targetStatus, reason } = body;

  if (!targetStatus || typeof targetStatus !== 'string') {
    console.warn('🔄 [TRANSITION_INVOICE] missing targetStatus');
    throw new ServiceError('Vui lòng cung cấp trạng thái mới (status).', 400);
  }

  const upper = String(targetStatus).toUpperCase().trim();
  console.log('🔄 [TRANSITION_INVOICE] target status =', upper);
  if (!STATUS_LABELS[upper]) {
    throw new ServiceError(`Trạng thái "${upper}" không hợp lệ. Các trạng thái hợp lệ: ${Object.keys(STATUS_LABELS).join(', ')}.`, 400);
  }

  const invoice = await invoiceRepo.findByIdLean(invoiceId);
  console.log('🔄 [TRANSITION_INVOICE] invoice found?', !!invoice, invoice?._id?.toString(), 'status=', invoice?.status);
  if (!invoice) {
    throw new ServiceError('Không tìm thấy hóa đơn', 404);
  }

  if (invoice.deletedAt) {
    console.warn('🔄 [TRANSITION_INVOICE] invoice is soft-deleted');
    throw new ServiceError('Hóa đơn này đã bị dừng (xóa mềm) trước đó và không thể thay đổi trạng thái.', 400);
  }

  const currentStatus = String(invoice.status || '').toUpperCase();
  const allowed = INVOICE_TRANSITIONS[currentStatus] || [];
  console.log('🔄 [TRANSITION_INVOICE] currentStatus =', currentStatus, 'allowed →', allowed);

  if (!allowed.includes(upper)) {
    console.warn('🔄 [TRANSITION_INVOICE] transition not allowed', { currentStatus, upper, allowed });
    throw new ServiceError(
      `Không thể chuyển từ "${STATUS_LABELS[currentStatus]}" sang "${STATUS_LABELS[upper]}". Các bước chuyển cho phép: ${allowed.length > 0 ? allowed.map(s => STATUS_LABELS[s]).join(', ') : 'không có (trạng thái cuối).'}`,
      400
    );
  }

  const patch = { status: upper };
  const issuedAt = new Date();
  const now = new Date();

  console.log('🔄 [TRANSITION_INVOICE] applying switch', `${currentStatus}→${upper}`);

  switch (`${currentStatus}→${upper}`) {
    // ── DRAFT ──
    case 'DRAFT→ISSUED': {
      // billingPeriodStart + 5 ngày = hạn thanh toán
      const periodStart = invoice.billingPeriodStart || invoice.periodStart || issuedAt;
      patch.issuedAt = issuedAt;
      patch.dueDate = new Date(new Date(periodStart).getTime() + 5 * 24 * 60 * 60 * 1000);
      patch.cancellationReason = null;
      patch.cancellationDate = null;
      patch.cancelledBy = null;
      break;
    }

    // ── ISSUED ──
    case 'ISSUED→DRAFT':
      // Thu hồi khỏi family — xóa ngày xuất + hạn
      patch.issuedAt = null;
      patch.dueDate = null;
      patch.paidAt = null;
      patch.remainingAmount = invoice.totalAmount;
      break;

    case 'ISSUED→PAID':
      patch.paidAt = now;
      patch.remainingAmount = 0;
      break;

    case 'ISSUED→CANCELLED':
      patch.cancellationReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
      patch.cancellationDate = now;
      patch.cancelledBy = admin._id;
      patch.paidAt = null;
      patch.remainingAmount = invoice.totalAmount;
      break;

    // ── PARTIALLY_PAID ──
    case 'PARTIALLY_PAID→ISSUED':
      // Hoàn tác thanh toán một phần
      patch.paidAt = null;
      patch.remainingAmount = invoice.totalAmount;
      break;

    case 'PARTIALLY_PAID→PAID':
      patch.paidAt = now;
      patch.remainingAmount = 0;
      break;

    // ── CANCELLED ──
    case 'CANCELLED→DRAFT':
      // Khôi phục hóa đơn đã hủy
      patch.cancellationReason = null;
      patch.cancellationDate = null;
      patch.cancelledBy = null;
      patch.paidAt = null;
      patch.remainingAmount = invoice.totalAmount;
      break;

    default:
      throw new ServiceError(`Bước chuyển "${currentStatus}→${upper}" chưa được hỗ trợ.`, 400);
  }

  const beforeData = {
    status: invoice.status,
    issuedAt: invoice.issuedAt || null,
    dueDate: invoice.dueDate || null,
    paidAt: invoice.paidAt || null,
    remainingAmount: Number(invoice.remainingAmount ?? 0),
    cancellationReason: invoice.cancellationReason || null,
  };

  console.log('🔄 [TRANSITION_INVOICE] saving patch →', patch);
  const updated = await invoiceRepo.updateById(invoiceId, patch);
  console.log('🔄 [TRANSITION_INVOICE] updateById result?', !!updated, 'new status =', updated?.status);

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'TRANSITION_INVOICE_STATUS',
    module: 'contract',
    targetEntityType: 'Invoice',
    targetEntityId: invoiceId,
    beforeData,
    afterData: { ...patch, reason },
    req,
  });

  return {
    message: `Đã chuyển hóa đơn từ "${STATUS_LABELS[currentStatus]}" → "${STATUS_LABELS[upper]}".`,
    invoiceId,
    previousStatus: currentStatus,
    newStatus: upper,
  };
};

module.exports = {
  createContract,
  listContracts,
  getContractDetails,
  renewContract,
  terminateContract,
  getContractHistory,
  issueInvoices,
  recalculateContractInvoices,
  updateDraftInvoicePrice,
  softDeleteDraftInvoice,
  transitionInvoiceStatus,
};

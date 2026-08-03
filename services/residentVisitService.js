const ServiceError = require('./serviceError');
const visitRepo = require('../repositories/residentVisitRepository');
const { assertResidentAccess } = require('./familyPortalService');
const { createAuditLog } = require('../utils/auditLog');

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const formatVisit = (visit) => ({
  _id: visit._id,
  status: visit.status,
  resident: visit.residentId?.fullName
    ? { _id: visit.residentId._id, fullName: visit.residentId.fullName, residentCode: visit.residentId.residentCode }
    : visit.residentId,
  familyAccount: visit.familyAccountId?.email
    ? { _id: visit.familyAccountId._id, fullName: visit.familyAccountId.fullName, email: visit.familyAccountId.email, phone: visit.familyAccountId.phone }
    : undefined,
  visitorName: visit.visitorName,
  visitorPhone: visit.visitorPhone,
  requestedDate: visit.requestedDate,
  requestedTimeSlot: visit.requestedTimeSlot,
  numberOfVisitors: visit.numberOfVisitors,
  notes: visit.notes,
  cancellationReason: visit.cancellationReason,
  cancelledAt: visit.cancelledAt,
  reviewedAt: visit.reviewedAt,
  rejectionReason: visit.rejectionReason,
  createdAt: visit.createdAt,
  updatedAt: visit.updatedAt,
});

// ── Family: create visit request ────────────────────────────────────────────────
const createVisit = async (user, body) => {
  if (!body || typeof body !== 'object') {
    throw new ServiceError('Nội dung yêu cầu trống', 400);
  }

  const { residentId, visitorName, visitorPhone, requestedDate, requestedTimeSlot, numberOfVisitors, notes } = body;

  if (!residentId) throw new ServiceError('residentId là bắt buộc', 400);
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Từ chối truy cập: không phải người thân của bạn', 403);
  }

  const name = typeof visitorName === 'string' ? visitorName.trim() : '';
  if (!name) throw new ServiceError('visitorName là bắt buộc', 400);

  const phone = typeof visitorPhone === 'string' ? visitorPhone.trim() : '';
  if (!phone) throw new ServiceError('visitorPhone là bắt buộc', 400);

  if (!requestedDate) throw new ServiceError('requestedDate là bắt buộc', 400);
  const parsedDate = new Date(requestedDate);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new ServiceError('requestedDate không hợp lệ (dùng định dạng ISO: YYYY-MM-DD)', 400);
  }
  const now = new Date();
  const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const startOfToday = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate(), 0, 0, 0, 0) - 7 * 60 * 60 * 1000);
  if (parsedDate < startOfToday) {
    throw new ServiceError('requestedDate phải là hôm nay hoặc trong tương lai', 400);
  }

  const visitors = numberOfVisitors ? parseInt(numberOfVisitors, 10) : 1;
  if (Number.isNaN(visitors) || visitors < 1 || visitors > 20) {
    throw new ServiceError('numberOfVisitors phải từ 1 đến 20', 400);
  }

  const vnTime = new Date(parsedDate.getTime() + 7 * 60 * 60 * 1000);
  const startOfDate = new Date(Date.UTC(vnTime.getUTCFullYear(), vnTime.getUTCMonth(), vnTime.getUTCDate(), 0, 0, 0, 0) - 7 * 60 * 60 * 1000);
  const endOfDate = new Date(Date.UTC(vnTime.getUTCFullYear(), vnTime.getUTCMonth(), vnTime.getUTCDate(), 23, 59, 59, 999) - 7 * 60 * 60 * 1000);

  const duplicateVisit = await visitRepo.findActiveVisitOnDate(residentId, startOfDate, endOfDate);
  if (duplicateVisit) {
    throw new ServiceError('Đã tồn tại yêu cầu thăm viếng cho cư dân này vào ngày này', 400);
  }

  const visit = await visitRepo.createVisit({
    residentId,
    familyAccountId: user._id,
    visitorName: name,
    visitorPhone: phone,
    requestedDate: parsedDate,
    requestedTimeSlot: requestedTimeSlot?.trim() || undefined,
    numberOfVisitors: visitors,
    notes: notes?.trim() || undefined,
    status: 'pending',
  });

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'CREATE_RESIDENT_VISIT',
    module: 'residentVisit',
    targetEntityType: 'ResidentVisit',
    targetEntityId: visit._id,
    afterData: { residentId, requestedDate: visit.requestedDate, status: visit.status },
  });

  return { message: 'Đã tạo yêu cầu thăm viếng thành công', visit: formatVisit(await visitRepo.findById(visit._id)) };
};

// ── Family: list own visit requests ─────────────────────────────────────────────
const listFamilyVisits = async (user, query) => {
  const filter = {};
  if (query.residentId) filter.residentId = query.residentId;
  if (query.status) filter.status = query.status;

  const { pageNum, limitNum, skip } = parsePagination(query);
  const sort = { createdAt: -1 };

  const [data, total] = await Promise.all([
    visitRepo.findByFamily(user._id, filter, { sort, skip, limit: limitNum }),
    visitRepo.countByFamily(user._id, filter),
  ]);

  return {
    data: data.map(formatVisit),
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  };
};

// ── Family: cancel a pending/approved visit ─────────────────────────────────────
const cancelVisit = async (user, visitId, body) => {
  const visit = await visitRepo.findByIdForFamily(visitId, user._id);
  if (!visit) throw new ServiceError('Không tìm thấy yêu cầu thăm viếng', 404);

  if (!visitRepo.CANCELLABLE_STATUSES.includes(visit.status)) {
    throw new ServiceError(
      `Không thể hủy yêu cầu thăm viếng ở trạng thái: ${visit.status}. Chỉ có thể hủy khi ở trạng thái ${visitRepo.CANCELLABLE_STATUSES.join(', ')}.`,
      400
    );
  }

  const cancellationReason = body?.cancellationReason?.trim() || '';
  const updated = await visitRepo.updateVisit(visit._id, {
    status: 'cancelled',
    cancelledAt: new Date(),
    cancellationReason: cancellationReason || undefined,
  });

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'CANCEL_RESIDENT_VISIT',
    module: 'residentVisit',
    targetEntityType: 'ResidentVisit',
    targetEntityId: visit._id,
    beforeData: { status: visit.status },
    afterData: { status: updated.status },
  });

  return { message: 'Đã hủy yêu cầu thăm viếng thành công', visit: formatVisit(updated) };
};

// ── Staff: list visits (nurse/manager/admin) ────────────────────────────────────
const listVisits = async (query) => {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.residentId) filter.residentId = query.residentId;

  const { pageNum, limitNum, skip } = parsePagination(query);
  const sort = { createdAt: -1 };

  const [data, total] = await Promise.all([
    visitRepo.findAll(filter, { sort, skip, limit: limitNum }),
    visitRepo.countAll(filter),
  ]);

  return {
    data: data.map(formatVisit),
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  };
};

// ── Staff: approve a pending visit (manager/admin) ──────────────────────────────
const approveVisit = async (actor, visitId) => {
  const visit = await visitRepo.findById(visitId);
  if (!visit) throw new ServiceError('Không tìm thấy yêu cầu thăm viếng', 404);

  if (!visitRepo.APPROVABLE_STATUSES.includes(visit.status)) {
    throw new ServiceError(
      `Không thể duyệt yêu cầu thăm viếng ở trạng thái: ${visit.status}. Chỉ có thể duyệt khi ở trạng thái ${visitRepo.APPROVABLE_STATUSES.join(', ')}.`,
      400
    );
  }

  const updated = await visitRepo.updateVisit(visitId, {
    status: 'approved',
    reviewedBy: actor._id,
    reviewedAt: new Date(),
  });

  await createAuditLog({
    actorUserId: actor._id,
    actorRole: actor.role,
    action: 'APPROVE_RESIDENT_VISIT',
    module: 'residentVisit',
    targetEntityType: 'ResidentVisit',
    targetEntityId: visit._id,
    beforeData: { status: visit.status },
    afterData: { status: updated.status },
  });

  return { message: 'Đã duyệt yêu cầu thăm viếng thành công', visit: formatVisit(updated) };
};

// ── Staff: reject a pending visit (manager/admin) ───────────────────────────────
const rejectVisit = async (actor, visitId, body) => {
  const visit = await visitRepo.findById(visitId);
  if (!visit) throw new ServiceError('Không tìm thấy yêu cầu thăm viếng', 404);

  if (!visitRepo.REJECTABLE_STATUSES.includes(visit.status)) {
    throw new ServiceError(
      `Không thể từ chối yêu cầu thăm viếng ở trạng thái: ${visit.status}. Chỉ có thể từ chối khi ở trạng thái ${visitRepo.REJECTABLE_STATUSES.join(', ')}.`,
      400
    );
  }

  const rejectionReason = body?.rejectionReason?.trim() || '';
  if (!rejectionReason) {
    throw new ServiceError('rejectionReason là bắt buộc khi từ chối yêu cầu thăm viếng', 400);
  }

  const updated = await visitRepo.updateVisit(visitId, {
    status: 'rejected',
    reviewedBy: actor._id,
    reviewedAt: new Date(),
    rejectionReason,
  });

  await createAuditLog({
    actorUserId: actor._id,
    actorRole: actor.role,
    action: 'REJECT_RESIDENT_VISIT',
    module: 'residentVisit',
    targetEntityType: 'ResidentVisit',
    targetEntityId: visit._id,
    beforeData: { status: visit.status },
    afterData: { status: updated.status, rejectionReason },
  });

  return { message: 'Đã từ chối yêu cầu thăm viếng thành công', visit: formatVisit(updated) };
};

module.exports = {
  createVisit,
  listFamilyVisits,
  cancelVisit,
  listVisits,
  approveVisit,
  rejectVisit,
};

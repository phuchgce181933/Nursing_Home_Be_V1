const ServiceError = require('./serviceError');
const tourRepo = require('../repositories/facilityTourRepository');
const { createAuditLog } = require('../utils/auditLog');
const { validateEmail } = require('../utils/validators');

const MAX_TEXT_LENGTH = 500;
const assertMaxLength = (value, fieldName, max = MAX_TEXT_LENGTH) => {
  if (value && value.length > max) {
    throw new ServiceError(`${fieldName} must be at most ${max} characters`, 400);
  }
};

// Accepts "HH:MM - HH:MM" or "HH:MM-HH:MM"
const parseSlotStart = (slot) => {
  if (!slot) return null;
  const [startPart] = String(slot).split('-').map((p) => p.trim());
  if (!startPart) return null;
  const [hour, minute] = startPart.split(':').map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return { hour, minute };
};

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const formatTour = (tour, { includeFamily = true } = {}) => {
  const base = {
    _id: tour._id,
    status: tour.status,
    contactName: tour.contactName,
    contactPhone: tour.contactPhone,
    contactEmail: tour.contactEmail,
    preferredDate: tour.preferredDate,
    preferredTimeSlot: tour.preferredTimeSlot,
    numberOfVisitors: tour.numberOfVisitors,
    notes: tour.notes,
    cancellationReason: tour.cancellationReason,
    cancelledAt: tour.cancelledAt,
    rejectionReason: tour.rejectionReason,
    rejectedAt: tour.rejectedAt,
    confirmedAt: tour.confirmedAt,
    confirmedTimeSlot: tour.confirmedTimeSlot,
    adminNotes: tour.adminNotes,
    completedAt: tour.completedAt,
    createdAt: tour.createdAt,
    updatedAt: tour.updatedAt,
  };

  if (includeFamily && tour.familyAccountId?.email) {
    base.familyAccount = {
      _id: tour.familyAccountId._id,
      fullName: tour.familyAccountId.fullName,
      email: tour.familyAccountId.email,
      phone: tour.familyAccountId.phone,
      username: tour.familyAccountId.username || 'N/A',
    };
  }

  return base;
};

// ── Schedule Facility Tour ──────────────────────────────────────────────────────
const scheduleTour = async (user, body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    throw new ServiceError(
      'Request body is empty. Use POST with Content-Type: application/json.',
      400
    );
  }

  const {
    contactName,
    contactPhone,
    contactEmail,
    preferredDate,
    preferredTimeSlot,
    numberOfVisitors,
    notes,
  } = body;

  // Validate required fields
  const name = typeof contactName === 'string' ? contactName.trim() : '';
  if (!name) throw new ServiceError('contactName is required', 400);
  if (name.length < 2 || name.length > 50) {
    throw new ServiceError('Tên phải từ 2 đến 50 ký tự', 400);
  }
  if (!/^[a-zA-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠàáâãèéêìíòóôõùúăđĩũơƯĂÂÊÔƠƯưăâêôơưẠ-ỹ\s]+$/.test(name)) {
    throw new ServiceError('Tên liên hệ chỉ được chứa chữ cái và khoảng trắng', 400);
  }

  const phone = typeof contactPhone === 'string' ? contactPhone.trim() : '';
  if (!phone) throw new ServiceError('contactPhone is required', 400);
  // Matches the admission-request page's phone format (Stage 1) so the two forms validate
  // phone numbers identically instead of each having its own slightly different regex.
  if (!/^(0|\+84)(3|5|7|8|9)\d{8}$/.test(phone)) {
    throw new ServiceError('Số điện thoại không hợp lệ (di động 10 chữ số bắt đầu bằng 03, 05, 07, 08 hoặc 09).', 400);
  }

  if (contactEmail) {
    const emailError = validateEmail(contactEmail.trim());
    if (emailError) throw new ServiceError(`contactEmail: ${emailError}`, 400);
  }

  assertMaxLength(name, 'contactName');
  assertMaxLength(notes?.trim(), 'notes');

  if (!preferredDate) throw new ServiceError('preferredDate is required', 400);
  const parsedDate = new Date(preferredDate);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new ServiceError('preferredDate is invalid (use ISO format: YYYY-MM-DD)', 400);
  }
  const now = new Date();
  const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const startOfToday = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate(), 0, 0, 0, 0) - 7 * 60 * 60 * 1000);
  if (parsedDate < startOfToday) {
    throw new ServiceError('preferredDate must be today or in the future', 400);
  }

  const y = vnNow.getUTCFullYear();
  const m = vnNow.getUTCMonth();
  const d = vnNow.getUTCDate();
  const preferredDateStr = parsedDate.toISOString().split('T')[0];
  const todayStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  if (preferredDateStr === todayStr && preferredTimeSlot) {
    const slotStart = parseSlotStart(preferredTimeSlot);
    if (slotStart) {
      const curHour = vnNow.getUTCHours();
      const curMin = vnNow.getUTCMinutes();
      if (curHour > slotStart.hour || (curHour === slotStart.hour && curMin >= slotStart.minute)) {
        throw new ServiceError('The selected time slot for today has already passed', 400);
      }
    }
  }

  const visitors = numberOfVisitors ? parseInt(numberOfVisitors, 10) : 1;
  if (Number.isNaN(visitors) || visitors < 1 || visitors > 20) {
    throw new ServiceError('numberOfVisitors must be between 1 and 20', 400);
  }

  // Anti-spam: Check if there is already a pending or confirmed tour request on the same preferredDate for this family
  // We calculate boundaries in Vietnam timezone (+07:00) so it works regardless of different UTC day offsets
  const vnTime = new Date(parsedDate.getTime() + 7 * 60 * 60 * 1000);
  const targetY = vnTime.getUTCFullYear();
  const targetM = vnTime.getUTCMonth();
  const targetD = vnTime.getUTCDate();
  
  const startOfDate = new Date(Date.UTC(targetY, targetM, targetD, 0, 0, 0, 0) - 7 * 60 * 60 * 1000);
  const endOfDate = new Date(Date.UTC(targetY, targetM, targetD, 23, 59, 59, 999) - 7 * 60 * 60 * 1000);

  const duplicateTour = await tourRepo.findActiveTourOnDate(user._id, startOfDate, endOfDate);
  if (duplicateTour) {
    throw new ServiceError(
      `You already have a ${duplicateTour.status} facility tour request scheduled on this date (${preferredDate.split('T')[0]}). Please cancel it or contact support to modify.`,
      400
    );
  }

  // Anti-spam: Limit the total number of pending tour requests a family can have at once to 3
  const pendingCount = await tourRepo.countByFamily(user._id, { status: 'pending' });
  if (pendingCount >= 3) {
    throw new ServiceError(
      'You cannot have more than 3 pending facility tour requests at the same time. Please wait for them to be processed or cancel an existing request.',
      400
    );
  }

  const tour = await tourRepo.createTour({
    familyAccountId: user._id,
    contactName: name,
    contactPhone: phone,
    contactEmail: contactEmail?.trim().toLowerCase() || undefined,
    preferredDate: parsedDate,
    preferredTimeSlot: preferredTimeSlot?.trim() || undefined,
    numberOfVisitors: visitors,
    notes: notes?.trim() || undefined,
    status: 'pending',
  });

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'SCHEDULE_FACILITY_TOUR',
    module: 'facilityTour',
    targetEntityType: 'FacilityTour',
    targetEntityId: tour._id,
    afterData: { contactName: tour.contactName, preferredDate: tour.preferredDate, status: tour.status },
    req,
  });

  return { message: 'Facility tour scheduled successfully', tour: formatTour(tour) };
};

// ── List Tour History ────────────────────────────────────────────────────────────
const listTourHistory = async (user, query) => {
  const filter = {};

  if (query.status) {
    const statuses = String(query.status)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of statuses) {
      if (!tourRepo.FACILITY_TOUR_STATUSES.includes(s)) {
        throw new ServiceError(
          `status must be one of: ${tourRepo.FACILITY_TOUR_STATUSES.join(', ')}`,
          400
        );
      }
    }
    filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }

  if (query.from || query.to) {
    filter.preferredDate = {};
    if (query.from) {
      const from = new Date(query.from);
      if (Number.isNaN(from.getTime())) throw new ServiceError('from date is invalid', 400);
      filter.preferredDate.$gte = from;
    }
    if (query.to) {
      const to = new Date(query.to);
      if (Number.isNaN(to.getTime())) throw new ServiceError('to date is invalid', 400);
      filter.preferredDate.$lte = to;
    }
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const sort = { createdAt: -1 };

  const [data, total] = await Promise.all([
    tourRepo.findByFamily(user._id, filter, { sort, skip, limit: limitNum }),
    tourRepo.countByFamily(user._id, filter),
  ]);

  return {
    data: data.map(formatTour),
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  };
};

// ── Cancel Facility Tour ─────────────────────────────────────────────────────────
const cancelTour = async (user, tourId, body, req) => {
  const tour = await tourRepo.findByIdForFamily(tourId, user._id);
  if (!tour) {
    throw new ServiceError('Facility tour request not found', 404);
  }

  if (!tourRepo.CANCELLABLE_STATUSES.includes(tour.status)) {
    throw new ServiceError(
      `Cannot cancel a tour with status: ${tour.status}. Only ${tourRepo.CANCELLABLE_STATUSES.join(', ')} can be cancelled.`,
      400
    );
  }

  const cancellationReason = body?.cancellationReason?.trim() || '';
  assertMaxLength(cancellationReason, 'cancellationReason');

  const updated = await tourRepo.updateTour(tour._id, {
    status: 'cancelled',
    cancelledAt: new Date(),
    cancellationReason: cancellationReason || undefined,
  });

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'CANCEL_FACILITY_TOUR',
    module: 'facilityTour',
    targetEntityType: 'FacilityTour',
    targetEntityId: tour._id,
    beforeData: { status: tour.status, preferredDate: tour.preferredDate },
    afterData: { status: updated.status, cancellationReason },
    req,
  });

  return { message: 'Facility tour cancelled successfully', tour: formatTour(updated) };
};

// ── Admin services ──────────────────────────────────────────────────────────────
const adminListTours = async (query) => {
  const filter = {};

  if (query.status) {
    const statuses = String(query.status)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of statuses) {
      if (!tourRepo.FACILITY_TOUR_STATUSES.includes(s)) {
        throw new ServiceError(
          `status must be one of: ${tourRepo.FACILITY_TOUR_STATUSES.join(', ')}`,
          400
        );
      }
    }
    filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }

  if (query.from || query.to) {
    filter.preferredDate = {};
    if (query.from) {
      const from = new Date(query.from);
      if (Number.isNaN(from.getTime())) throw new ServiceError('from date is invalid', 400);
      filter.preferredDate.$gte = from;
    }
    if (query.to) {
      const to = new Date(query.to);
      if (Number.isNaN(to.getTime())) throw new ServiceError('to date is invalid', 400);
      filter.preferredDate.$lte = to;
    }
  }

  if (query.search) {
    const term = query.search.trim();
    filter.$or = [
      { contactName: { $regex: term, $options: 'i' } },
      { contactPhone: { $regex: term, $options: 'i' } },
      { contactEmail: { $regex: term, $options: 'i' } },
    ];
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const sort = { createdAt: -1 };

  const [data, total] = await Promise.all([
    tourRepo.findAll(filter, { sort, skip, limit: limitNum }),
    tourRepo.countAll(filter),
  ]);

  return {
    data: data.map((t) => formatTour(t, { includeFamily: true })),
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  };
};

const adminGetTour = async (tourId) => {
  const tour = await tourRepo.findByIdForAdmin(tourId);
  if (!tour) throw new ServiceError('Facility tour request not found', 404);
  return { tour: formatTour(tour, { includeFamily: true }) };
};

const approveTour = async (admin, tourId, body, req) => {
  const tour = await tourRepo.findByIdForAdmin(tourId);
  if (!tour) throw new ServiceError('Facility tour request not found', 404);

  if (!tourRepo.APPROVABLE_STATUSES.includes(tour.status)) {
    throw new ServiceError(
      `Cannot approve a tour with status: ${tour.status}. Only ${tourRepo.APPROVABLE_STATUSES.join(', ')} can be approved.`,
      400
    );
  }

  const updateData = {
    status: 'confirmed',
    confirmedAt: new Date(),
  };
  if (body?.confirmedTimeSlot) updateData.confirmedTimeSlot = String(body.confirmedTimeSlot).trim();
  if (body?.adminNotes) {
    assertMaxLength(String(body.adminNotes).trim(), 'adminNotes');
    updateData.adminNotes = String(body.adminNotes).trim();
  }

  const updated = await tourRepo.updateTour(tourId, updateData);

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'APPROVE_FACILITY_TOUR',
    module: 'facilityTour',
    targetEntityType: 'FacilityTour',
    targetEntityId: tour._id,
    beforeData: { status: tour.status },
    afterData: { status: updated.status, confirmedAt: updated.confirmedAt, confirmedTimeSlot: updated.confirmedTimeSlot },
    req,
  });

  return { message: 'Facility tour approved successfully', tour: formatTour(updated) };
};

const completeTour = async (admin, tourId, body, req) => {
  const tour = await tourRepo.findByIdForAdmin(tourId);
  if (!tour) throw new ServiceError('Facility tour request not found', 404);

  if (!tourRepo.COMPLETABLE_STATUSES.includes(tour.status)) {
    throw new ServiceError(
      `Cannot complete a tour with status: ${tour.status}. Only ${tourRepo.COMPLETABLE_STATUSES.join(', ')} tours can be marked as completed.`,
      400
    );
  }

  const updateData = {
    status: 'completed',
    completedAt: new Date(),
  };
  if (body?.adminNotes) {
    assertMaxLength(String(body.adminNotes).trim(), 'adminNotes');
    updateData.adminNotes = String(body.adminNotes).trim();
  }

  const updated = await tourRepo.updateTour(tourId, updateData);

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'COMPLETE_FACILITY_TOUR',
    module: 'facilityTour',
    targetEntityType: 'FacilityTour',
    targetEntityId: tour._id,
    beforeData: { status: tour.status },
    afterData: { status: updated.status, completedAt: updated.completedAt },
    req,
  });

  return { message: 'Facility tour marked as completed', tour: formatTour(updated) };
};

const rejectTour = async (admin, tourId, body, req) => {
  const tour = await tourRepo.findByIdForAdmin(tourId);
  if (!tour) throw new ServiceError('Facility tour request not found', 404);

  if (!tourRepo.REJECTABLE_STATUSES.includes(tour.status)) {
    throw new ServiceError(
      `Cannot reject a tour with status: ${tour.status}. Only ${tourRepo.REJECTABLE_STATUSES.join(', ')} can be rejected.`,
      400
    );
  }

  const rejectionReason = body?.rejectionReason?.trim() || '';
  if (!rejectionReason) {
    throw new ServiceError('rejectionReason is required when rejecting a tour request', 400);
  }
  assertMaxLength(rejectionReason, 'rejectionReason');

  const updated = await tourRepo.updateTour(tourId, {
    status: 'cancelled',
    rejectionReason,
    rejectedAt: new Date(),
    cancelledAt: new Date(),
    cancellationReason: `[Admin rejected] ${rejectionReason}`,
  });

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'REJECT_FACILITY_TOUR',
    module: 'facilityTour',
    targetEntityType: 'FacilityTour',
    targetEntityId: tour._id,
    beforeData: { status: tour.status },
    afterData: { status: updated.status, rejectionReason },
    req,
  });

  return { message: 'Facility tour rejected successfully', tour: formatTour(updated) };
};

module.exports = {
  scheduleTour,
  listTourHistory,
  cancelTour,
  adminListTours,
  adminGetTour,
  approveTour,
  completeTour,
  rejectTour,
};

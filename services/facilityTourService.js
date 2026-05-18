const ServiceError = require('./serviceError');
const tourRepo = require('../repositories/facilityTourRepository');
const { createAuditLog } = require('../utils/auditLog');

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const formatTour = (tour) => ({
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
  confirmedAt: tour.confirmedAt,
  confirmedTimeSlot: tour.confirmedTimeSlot,
  adminNotes: tour.adminNotes,
  createdAt: tour.createdAt,
  updatedAt: tour.updatedAt,
});

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

  const phone = typeof contactPhone === 'string' ? contactPhone.trim() : '';
  if (!phone) throw new ServiceError('contactPhone is required', 400);

  if (!preferredDate) throw new ServiceError('preferredDate is required', 400);
  const parsedDate = new Date(preferredDate);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new ServiceError('preferredDate is invalid (use ISO format: YYYY-MM-DD)', 400);
  }
  if (parsedDate < new Date()) {
    throw new ServiceError('preferredDate must be in the future', 400);
  }

  const visitors = numberOfVisitors ? parseInt(numberOfVisitors, 10) : 1;
  if (Number.isNaN(visitors) || visitors < 1 || visitors > 20) {
    throw new ServiceError('numberOfVisitors must be between 1 and 20', 400);
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
    if (!tourRepo.FACILITY_TOUR_STATUSES.includes(query.status)) {
      throw new ServiceError(
        `status must be one of: ${tourRepo.FACILITY_TOUR_STATUSES.join(', ')}`,
        400
      );
    }
    filter.status = query.status;
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

  const cancellationReason = body?.cancellationReason?.trim() || body?.reason?.trim() || '';

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

module.exports = {
  scheduleTour,
  listTourHistory,
  cancelTour,
};

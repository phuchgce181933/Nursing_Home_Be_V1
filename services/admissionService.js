const ServiceError = require('./serviceError');
const admissionRepo = require('../repositories/admissionRepository');
const invoiceRepo = require('../repositories/invoiceRepository');
const { GENDERS, BLOOD_TYPES, ADMISSION_STATUSES, ADMISSION_ELIGIBILITY_STATUSES } = require('../models/enums');
const { createAuditLog } = require('../utils/auditLog');
const User = require('../models/user');
const Resident = require('../models/resident');
const Bed = require('../models/bed');
const Room = require('../models/room');
const CareAppointment = require('../models/careAppointment');
const servicePackageRepo = require('../repositories/servicePackageRepository');

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const formatAdmission = (admission, { includeFamily = true } = {}) => {
  const base = {
    _id: admission._id,
    requestCode: admission.requestCode,
    status: admission.status,
    eligibilityStatus: admission.eligibilityStatus,
    residentId: admission.residentId?._id || admission.residentId || null,
    resident: admission.residentId?.residentCode
      ? {
          _id: admission.residentId._id,
          residentCode: admission.residentId.residentCode,
          fullName: admission.residentId.fullName,
          residencyStatus: admission.residentId.residencyStatus,
        }
      : null,
    applicant: admission.applicant,
    preferredAdmissionDate: admission.preferredAdmissionDate,
    reasonForAdmission: admission.reasonForAdmission,
    requestedByName: admission.requestedByName,
    requestedByPhone: admission.requestedByPhone,
    requestedAt: admission.requestedAt,
    consultationNotes: admission.consultationNotes,
    consultedBy: admission.consultedBy?._id
      ? { _id: admission.consultedBy._id, fullName: admission.consultedBy.fullName, role: admission.consultedBy.role, email: admission.consultedBy.email }
      : admission.consultedBy || null,
    consultedAt: admission.consultedAt,
    consultantId: admission.consultantId?._id
      ? { _id: admission.consultantId._id, fullName: admission.consultantId.fullName, role: admission.consultantId.role, email: admission.consultantId.email }
      : admission.consultantId || null,
    consultationScheduledAt: admission.consultationScheduledAt,
    initialAssessmentScheduledAt: admission.initialAssessmentScheduledAt,
    initialAssessmentNotes: admission.initialAssessmentNotes,
    assessmentResult: admission.assessmentResult,
    assessedBy: admission.assessedBy?._id
      ? { _id: admission.assessedBy._id, fullName: admission.assessedBy.fullName, role: admission.assessedBy.role, email: admission.assessedBy.email }
      : admission.assessedBy || null,
    assessedAt: admission.assessedAt,
    servicePackageId: admission.servicePackageId?._id
      ? { _id: admission.servicePackageId._id, packageCode: admission.servicePackageId.packageCode, name: admission.servicePackageId.name, tier: admission.servicePackageId.tier, monthlyPrice: admission.servicePackageId.monthlyPrice }
      : admission.servicePackageId || null,
    assignedServicePackage: admission.assignedServicePackage,
    contractNumber: admission.contractNumber,
    contractSignedAt: admission.contractSignedAt,
    contractStartDate: admission.contractStartDate,
    contractEndDate: admission.contractEndDate,
    contractDurationMonths: admission.contractDurationMonths,
    contractDiscountPercent: admission.contractDiscountPercent,
    contractTerms: admission.contractTerms,
    assignedBedId: admission.assignedBedId?._id || admission.assignedBedId || null,
    assignedBed: admission.assignedBedId?.bedCode
      ? { _id: admission.assignedBedId._id, bedCode: admission.assignedBedId.bedCode }
      : null,
    assignedRoomId: admission.assignedRoomId?._id || admission.assignedRoomId || null,
    assignedRoom: admission.assignedRoomId?.roomNumber
      ? { _id: admission.assignedRoomId._id, roomNumber: admission.assignedRoomId.roomNumber }
      : null,
    checkInAt: admission.checkInAt,
    cancelledAt: admission.cancelledAt,
    cancellationReason: admission.cancellationReason,
    rejectionReason: admission.rejectionReason,
    rejectedAt: admission.rejectedAt,
    approvedAt: admission.approvedAt,
    notes: admission.notes,
    createdAt: admission.createdAt,
    updatedAt: admission.updatedAt,
  };

  if (includeFamily && admission.familyAccountId?.email) {
    base.familyAccount = {
      _id: admission.familyAccountId._id,
      fullName: admission.familyAccountId.fullName,
      email: admission.familyAccountId.email,
      phone: admission.familyAccountId.phone,
      username: admission.familyAccountId.username || 'N/A',
    };
  }

  return base;
};

const getCareAppointmentForResident = async (residentId) => {
  if (!residentId) return null;
  const CareAppointment = require('../models/careAppointment');
  try {
    const careAppt = await CareAppointment.findOne({
      residentId,
      appointmentType: 'Khám lâm sàng đầu vào',
    })
      .populate({
        path: 'doctorStaffId',
        populate: { path: 'userId', select: 'fullName email' }
      })
      .populate({
        path: 'nurseStaffId',
        populate: { path: 'userId', select: 'fullName email' }
      });

    if (careAppt) {
      return {
        _id: careAppt._id,
        scheduledStartAt: careAppt.scheduledStartAt,
        scheduledEndAt: careAppt.scheduledEndAt,
        status: careAppt.status,
        doctor: careAppt.doctorStaffId
          ? {
              _id: careAppt.doctorStaffId._id,
              fullName: careAppt.doctorStaffId.userId?.fullName || careAppt.doctorStaffId.fullName || 'Bác sĩ',
              email: careAppt.doctorStaffId.userId?.email || careAppt.doctorStaffId.email || '',
            }
          : null,
        nurse: careAppt.nurseStaffId
          ? {
              _id: careAppt.nurseStaffId._id,
              fullName: careAppt.nurseStaffId.userId?.fullName || careAppt.nurseStaffId.fullName || 'Điều dưỡng',
              email: careAppt.nurseStaffId.userId?.email || careAppt.nurseStaffId.email || '',
            }
          : null,
      };
    }
  } catch (err) {
    console.error('Failed to fetch assigned care appointment for drawer:', err);
  }
  return null;
};

const getLatestInvoiceForResident = async (residentId) => {
  if (!residentId) return null;
  const invoices = await invoiceRepo.findByResidentId(residentId, { sort: { issuedAt: -1 }, limit: 1 });
  return Array.isArray(invoices) && invoices.length ? invoices[0] : null;
};

const generateRequestCode = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `REQ${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const exists = await admissionRepo.findByRequestCode(code);
    if (!exists) return code;
  }
  throw new ServiceError('Unable to generate request code', 500);
};

const normalizeStringArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return [String(value).trim()].filter(Boolean);
};

const buildApplicant = (applicant, relationshipToRequester) => {
  const fullName =
    typeof applicant?.fullName === 'string'
      ? applicant.fullName.trim()
      : applicant?.fullName != null
        ? String(applicant.fullName).trim()
        : '';

  if (!fullName) {
    const receivedKeys =
      applicant && typeof applicant === 'object' && !Array.isArray(applicant)
        ? Object.keys(applicant).join(', ') || '(empty object)'
        : typeof applicant;
    throw new ServiceError(
      `applicant.fullName is required. Received applicant keys: ${receivedKeys}. Send JSON body with Content-Type: application/json.`,
      400
    );
  }

  const relationship = (applicant.relationshipToRequester || relationshipToRequester)?.trim();
  if (!relationship) {
    throw new ServiceError('applicant.relationshipToRequester is required', 400);
  }

  if (applicant.gender && !GENDERS.includes(applicant.gender)) {
    throw new ServiceError(`applicant.gender must be one of: ${GENDERS.join(', ')}`, 400);
  }
  if (applicant.bloodType && !BLOOD_TYPES.includes(applicant.bloodType)) {
    throw new ServiceError(`applicant.bloodType must be one of: ${BLOOD_TYPES.join(', ')}`, 400);
  }

  const dateOfBirth = applicant.dateOfBirth ? new Date(applicant.dateOfBirth) : undefined;
  if (applicant.dateOfBirth && Number.isNaN(dateOfBirth?.getTime())) {
    throw new ServiceError('applicant.dateOfBirth is invalid', 400);
  }

  return {
    fullName,
    dateOfBirth,
    gender: applicant.gender || 'unknown',
    citizenId: applicant.citizenId?.trim(),
    bloodType: applicant.bloodType || 'unknown',
    personalAddress: applicant.personalAddress?.trim(),
    relationshipToRequester: relationship,
    allergies: normalizeStringArray(applicant.allergies),
    chronicConditions: normalizeStringArray(applicant.chronicConditions),
    initialHealthCondition: applicant.initialHealthCondition?.trim(),
  };
};

const submitAdmissionRequest = async (user, body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    throw new ServiceError(
      'Request body is empty or not parsed. Use POST with Header Content-Type: application/json and Body type raw → JSON.',
      400
    );
  }

  const {
    residentId,
    applicant,
    relationshipToRequester,
    preferredAdmissionDate,
    reasonForAdmission,
    notes,
    requestedByPhone,
  } = body;

  if (!residentId && (!applicant || typeof applicant !== 'object')) {
    throw new ServiceError('applicant object is required in request body', 400);
  }

  let resolvedApplicant;
  let resolvedResidentId = residentId || null;

  if (resolvedResidentId) {
    const resident = await admissionRepo.assertFamilyResidentAccess(user._id, resolvedResidentId);
    if (!resident) {
      throw new ServiceError('Access denied: resident is not linked to your account', 403);
    }
    if (resident.residencyStatus === 'admitted') {
      throw new ServiceError('This resident is already admitted', 400);
    }

    const activeForResident = await admissionRepo.findActiveAdmission({ residentId: resolvedResidentId });
    if (activeForResident) {
      throw new ServiceError('An active admission request already exists for this resident', 409);
    }

    resolvedApplicant = buildApplicant(
      applicant || {
        fullName: resident.fullName,
        dateOfBirth: resident.dateOfBirth,
        gender: resident.gender,
        citizenId: resident.citizenId,
        bloodType: resident.bloodType,
        personalAddress: resident.personalAddress,
        allergies: resident.allergies,
        chronicConditions: resident.chronicConditions,
        initialHealthCondition: resident.initialHealthCondition,
        relationshipToRequester,
      },
      relationshipToRequester
    );
  } else {
    resolvedApplicant = buildApplicant(applicant, relationshipToRequester);

    const duplicateFilter = {
      familyAccountId: user._id,
      'applicant.fullName': resolvedApplicant.fullName,
    };
    if (resolvedApplicant.citizenId) {
      duplicateFilter['applicant.citizenId'] = resolvedApplicant.citizenId;
    }
    const activeDuplicate = await admissionRepo.findActiveAdmission(duplicateFilter);
    if (activeDuplicate) {
      throw new ServiceError('You already have a pending admission request for this person', 409);
    }
  }

  let preferredDate;
  if (preferredAdmissionDate) {
    preferredDate = new Date(preferredAdmissionDate);
    if (Number.isNaN(preferredDate.getTime())) {
      throw new ServiceError('preferredAdmissionDate is invalid', 400);
    }
  }

  const requestCode = await generateRequestCode();
  const admission = await admissionRepo.createAdmission({
    requestCode,
    residentId: resolvedResidentId,
    familyAccountId: user._id,
    applicant: resolvedApplicant,
    preferredAdmissionDate: preferredDate,
    reasonForAdmission: reasonForAdmission?.trim(),
    requestedByName: user.fullName,
    requestedByPhone: requestedByPhone?.trim() || user.phone,
    notes: notes?.trim(),
    status: 'new_request',
    eligibilityStatus: 'pending',
  });

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'SUBMIT_ADMISSION_REQUEST',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    afterData: {
      requestCode: admission.requestCode,
      status: admission.status,
      applicantName: admission.applicant?.fullName,
    },
    req,
  });

  return {
    message: 'Admission request submitted successfully',
    admission: formatAdmission(admission),
  };
};

const listAdmissionHistory = async (user, query) => {
  const filter = {};

  if (query.status) {
    if (!ADMISSION_STATUSES.includes(query.status)) {
      throw new ServiceError(`status must be one of: ${ADMISSION_STATUSES.join(', ')}`, 400);
    }
    filter.status = query.status;
  }

  if (query.from || query.to) {
    filter.requestedAt = {};
    if (query.from) {
      const from = new Date(query.from);
      if (Number.isNaN(from.getTime())) throw new ServiceError('from date is invalid', 400);
      filter.requestedAt.$gte = from;
    }
    if (query.to) {
      const to = new Date(query.to);
      if (Number.isNaN(to.getTime())) throw new ServiceError('to date is invalid', 400);
      filter.requestedAt.$lte = to;
    }
  }

  if (query.search) {
    const term = query.search.trim();
    filter.$or = [
      { requestCode: { $regex: term, $options: 'i' } },
      { 'applicant.fullName': { $regex: term, $options: 'i' } },
      { 'applicant.citizenId': { $regex: term, $options: 'i' } },
    ];
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const sort = { requestedAt: -1 };

  const [data, total] = await Promise.all([
    admissionRepo.findByFamily(user._id, filter, { sort, skip, limit: limitNum }),
    admissionRepo.countByFamily(user._id, filter),
  ]);

  return {
    data: data.map(formatAdmission),
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  };
};

const getAdmissionRequest = async (user, admissionId) => {
  const admission = await admissionRepo.findByIdForFamily(admissionId, user._id);
  if (!admission) {
    throw new ServiceError('Admission request not found', 404);
  }
  await admission.populate([
    { path: 'residentId', select: 'residentCode fullName residencyStatus' },
    { path: 'consultantId', select: 'fullName email role' },
    { path: 'consultedBy', select: 'fullName email role' },
    { path: 'assessedBy', select: 'fullName email role' },
    { path: 'servicePackageId', select: 'packageCode name tier monthlyPrice' },
    { path: 'assignedBedId', select: 'bedCode' },
    { path: 'assignedRoomId', select: 'roomNumber' },
  ]);
  const formatted = formatAdmission(admission);
  formatted.assignedCareAppointment = await getCareAppointmentForResident(admission.residentId?._id || admission.residentId);
  formatted.latestInvoice = await getLatestInvoiceForResident(admission.residentId?._id || admission.residentId);
  return { admission: formatted };
};

const cancelAdmissionRequest = async (user, admissionId, body, req) => {
  const admission = await admissionRepo.findByIdForFamily(admissionId, user._id);
  if (!admission) {
    throw new ServiceError('Admission request not found', 404);
  }

  if (admission.status === 'cancelled') {
    throw new ServiceError('This admission request is already cancelled', 400);
  }

  if (admission.status === 'checked_in') {
    throw new ServiceError('Cannot cancel an admission request that has already been checked in', 400);
  }

  if (!admissionRepo.CANCELLABLE_STATUSES.includes(admission.status)) {
    throw new ServiceError(`Cannot cancel request with status: ${admission.status}`, 400);
  }

  // Block cancellation if the intake clinical appointment has already been completed by the doctor
  const residentId = admission.residentId?._id || admission.residentId;
  if (residentId) {
    const completedAppt = await CareAppointment.findOne({
      residentId: residentId,
      appointmentType: 'Khám lâm sàng đầu vào',
      status: 'completed',
    });
    if (completedAppt) {
      throw new ServiceError(
        'Không thể hủy yêu cầu nhập viện sau khi bác sĩ đã hoàn thành khám lâm sàng đầu vào. Vui lòng liên hệ ban quản lý để được hỗ trợ.',
        403
      );
    }
  }

  const cancellationReason = body?.cancellationReason?.trim() || body?.reason?.trim() || '';

  const updated = await admissionRepo.updateAdmission(admission._id, {
    status: 'cancelled',
    cancelledAt: new Date(),
    cancellationReason: cancellationReason || undefined,
  });

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'CANCEL_ADMISSION_REQUEST',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: { requestCode: admission.requestCode, status: admission.status },
    afterData: { requestCode: updated.requestCode, status: updated.status, cancellationReason },
    req,
  });

  return {
    message: 'Admission request cancelled successfully',
    admission: formatAdmission(updated),
  };
};

// ── Admin services ─────────────────────────────────────────────────────────────────
const adminListAdmissions = async (query, user) => {
  const filter = {};

  if (user && ['doctor', 'nurse'].includes(user.role)) {
    const medicalStatuses = ADMISSION_STATUSES;
    if (query.status) {
      const statuses = String(query.status)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => medicalStatuses.includes(s));
      filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses.length ? statuses : medicalStatuses };
    } else {
      filter.status = { $in: medicalStatuses };
    }
  } else if (query.status) {
    const statuses = String(query.status)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of statuses) {
      if (!ADMISSION_STATUSES.includes(s)) {
        throw new ServiceError(`status must be one of: ${ADMISSION_STATUSES.join(', ')}`, 400);
      }
    }
    filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }

  if (query.eligibilityStatus) {
    const { ADMISSION_ELIGIBILITY_STATUSES } = require('../models/enums');
    if (!ADMISSION_ELIGIBILITY_STATUSES.includes(query.eligibilityStatus)) {
      throw new ServiceError(`eligibilityStatus must be one of: ${ADMISSION_ELIGIBILITY_STATUSES.join(', ')}`, 400);
    }
    filter.eligibilityStatus = query.eligibilityStatus;
  }

  if (query.from || query.to) {
    filter.requestedAt = {};
    if (query.from) {
      const from = new Date(query.from);
      if (Number.isNaN(from.getTime())) throw new ServiceError('from date is invalid', 400);
      filter.requestedAt.$gte = from;
    }
    if (query.to) {
      const to = new Date(query.to);
      if (Number.isNaN(to.getTime())) throw new ServiceError('to date is invalid', 400);
      filter.requestedAt.$lte = to;
    }
  }

  if (query.residentId) {
    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(query.residentId)) {
      filter.residentId = new mongoose.Types.ObjectId(String(query.residentId));
    }
  }

  if (query.search) {
    const term = query.search.trim();
    filter.$or = [
      { requestCode: { $regex: term, $options: 'i' } },
      { 'applicant.fullName': { $regex: term, $options: 'i' } },
      { 'applicant.citizenId': { $regex: term, $options: 'i' } },
      { requestedByPhone: { $regex: term, $options: 'i' } },
    ];
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const sort = { requestedAt: -1 };

  const [data, total] = await Promise.all([
    admissionRepo.findAll(filter, { sort, skip, limit: limitNum }),
    admissionRepo.countAll(filter),
  ]);

  const latestInvoices = await Promise.all(
    data.map((admission) => getLatestInvoiceForResident(admission.residentId?._id || admission.residentId))
  );

  return {
    data: data.map((a, index) => {
      const formatted = formatAdmission(a, { includeFamily: true });
      formatted.latestInvoice = latestInvoices[index] || null;
      formatted.latestInvoiceStatus = formatted.latestInvoice?.status?.toString().toLowerCase?.() || null;
      return formatted;
    }),
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  };
};

const adminGetAdmission = async (admissionId, user) => {
  const admission = await admissionRepo.findByIdForAdmin(admissionId);
  if (!admission) {
    throw new ServiceError('Admission request not found', 404);
  }
  if (user && ['doctor', 'nurse'].includes(user.role)) {
    const medicalStatuses = ADMISSION_STATUSES;
    if (!medicalStatuses.includes(admission.status)) {
      throw new ServiceError('Access denied: medical staff can only view requests in allowed phases', 403);
    }
  }
  const formatted = formatAdmission(admission, { includeFamily: true });
  formatted.assignedCareAppointment = await getCareAppointmentForResident(admission.residentId?._id || admission.residentId);
  formatted.latestInvoice = await getLatestInvoiceForResident(admission.residentId?._id || admission.residentId);
  return { admission: formatted };
};

const approveAdmission = async (admin, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Admission request not found', 404);
  }

  if (!admissionRepo.APPROVABLE_STATUSES.includes(admission.status)) {
    throw new ServiceError(
      `Cannot approve admission with status: ${admission.status}. Only ${admissionRepo.APPROVABLE_STATUSES.join(', ')} are allowed.`,
      400
    );
  }

  // Guard: prevent double-approval — if already approved once, reject
  if (admission.approvedAt) {
    throw new ServiceError(
      'Yêu cầu nhập viện này đã được duyệt trước đó. Không thể duyệt lại một yêu cầu đã được phê duyệt.',
      409
    );
  }

  // Admin approval moves to 'assessing' so Doctor can perform clinical check-up first
  // Status only moves to 'contracting' after Doctor evaluates eligibility as 'eligible'
  const nextStatus = 'assessing';
  const updateData = {
    status: nextStatus,
    // Do NOT set eligibilityStatus: 'eligible' here - that's determined by the Doctor
    approvedAt: new Date(),
  };

  if (body?.notes) updateData.notes = String(body.notes).trim();

  // Create Resident at UC-6.7 if not already exists (status: 'pending')
  let residentId = admission.residentId;
  if (!residentId) {
    const residentCode = await generateResidentCode();
    const applicant = admission.applicant || {};
    const resident = await Resident.create({
      residentCode,
      fullName: applicant.fullName || 'Unknown',
      dateOfBirth: applicant.dateOfBirth,
      gender: applicant.gender || 'unknown',
      citizenId: applicant.citizenId,
      bloodType: applicant.bloodType || 'unknown',
      personalAddress: applicant.personalAddress,
      allergies: applicant.allergies || [],
      chronicConditions: applicant.chronicConditions || [],
      initialHealthCondition: applicant.initialHealthCondition,
      residencyStatus: 'pending',
      familyPortalAccountIds: [admission.familyAccountId],
    });
    residentId = resident._id;
    updateData.residentId = residentId;
  }

  const updated = await admissionRepo.updateAdmission(admissionId, updateData);

  // Automatically create first Care Appointment at UC-12
  // Guard: only create if no intake appointment already exists for this resident
  const existingAppt = await CareAppointment.findOne({
    residentId: residentId,
    appointmentType: 'Khám lâm sàng đầu vào',
    status: { $ne: 'cancelled' },
  });

  if (!existingAppt) {
    const start = admission.preferredAdmissionDate ? new Date(admission.preferredAdmissionDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    start.setHours(8, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour duration

    await CareAppointment.create({
      residentId: residentId,
      scheduledStartAt: start,
      scheduledEndAt: end,
      appointmentType: 'Khám lâm sàng đầu vào',
      status: 'scheduled',
      notes: `Lịch hẹn khám lâm sàng đầu vào được tạo tự động từ việc phê duyệt đơn nhập viện mã ${admission.requestCode || admission._id}.`,
    });
  }

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'APPROVE_ADMISSION_REQUEST',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: { requestCode: admission.requestCode, status: admission.status, eligibilityStatus: admission.eligibilityStatus },
    afterData: { requestCode: updated.requestCode, status: updated.status, eligibilityStatus: updated.eligibilityStatus, residentId: residentId },
    req,
  });

  return {
    message: 'Admission request approved successfully',
    admission: formatAdmission(updated, { includeFamily: true }),
  };
};

const rejectAdmission = async (admin, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Admission request not found', 404);
  }

  if (!admissionRepo.REJECTABLE_STATUSES.includes(admission.status)) {
    throw new ServiceError(
      `Cannot reject admission with status: ${admission.status}. Only ${admissionRepo.REJECTABLE_STATUSES.join(', ')} are allowed.`,
      400
    );
  }

  const rejectionReason = body?.rejectionReason?.trim() || body?.reason?.trim() || '';
  if (!rejectionReason) {
    throw new ServiceError('rejectionReason is required when rejecting an admission request', 400);
  }

  const updated = await admissionRepo.updateAdmission(admissionId, {
    status: 'cancelled',
    eligibilityStatus: 'not_eligible',
    rejectionReason,
    rejectedAt: new Date(),
    cancelledAt: new Date(),
    cancellationReason: `[Admin rejected] ${rejectionReason}`,
  });

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'REJECT_ADMISSION_REQUEST',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: { requestCode: admission.requestCode, status: admission.status },
    afterData: { requestCode: updated.requestCode, status: updated.status, rejectionReason },
    req,
  });

  return {
    message: 'Admission request rejected successfully',
    admission: formatAdmission(updated, { includeFamily: true }),
  };
};

// ── UC-6.16: Pre-admission Consultation ─────────────────────────────────────────
const preAdmissionConsultation = async (user, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Admission request not found', 404);
  }

  // Allow consultation when admission is in any pre-contracting medical phase or contracting
  if (!['new_request', 'consulting', 'assessing', 'contracting'].includes(admission.status)) {
    throw new ServiceError(
      `Cannot perform consultation on admission with status: ${admission.status}. Only new_request, consulting, assessing, contracting are allowed.`,
      400
    );
  }

  const consultationNotes = body?.consultationNotes?.trim();
  if (!consultationNotes) {
    throw new ServiceError('consultationNotes is required', 400);
  }

  // Anti-spam: Chặn gọi lại liên tục trong vòng 30 giây
  if (admission.consultedAt) {
    const secondsSinceLast = (Date.now() - new Date(admission.consultedAt).getTime()) / 1000;
    if (secondsSinceLast < 30) {
      throw new ServiceError(
        `Tư vấn vừa được cập nhật ${Math.ceil(30 - secondsSinceLast)} giây trước. Vui lòng đợi đủ 30 giây trước khi cập nhật lại.`,
        429
      );
    }
  }

  const updateData = {
    consultationNotes,
    consultedBy: user._id,
    consultedAt: new Date(),
    status: ['contracting', 'checked_in'].includes(admission.status) ? admission.status : 'consulting',
  };
  if (body?.notes) updateData.notes = String(body.notes).trim();

  const updated = await admissionRepo.updateAdmission(admissionId, updateData);

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'PRE_ADMISSION_CONSULTATION',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: { requestCode: admission.requestCode, status: admission.status },
    afterData: { requestCode: updated.requestCode, status: updated.status, consultationNotes },
    req,
  });

  return {
    message: 'Pre-admission consultation recorded successfully',
    admission: formatAdmission(updated),
  };
};

// ── UC-6.17: Initial Assessment Scheduling ──────────────────────────────────────
const scheduleInitialAssessment = async (user, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Admission request not found', 404);
  }

  if (!['new_request', 'consulting', 'assessing'].includes(admission.status)) {
    throw new ServiceError(
      `Cannot schedule assessment for admission with status: ${admission.status}`,
      400
    );
  }

  const scheduledAt = body?.scheduledAt ? new Date(body.scheduledAt) : null;
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    throw new ServiceError('scheduledAt is required and must be a valid date', 400);
  }

  if (scheduledAt <= new Date()) {
    throw new ServiceError('scheduledAt must be a future date', 400);
  }

  const updateData = {
    initialAssessmentScheduledAt: scheduledAt,
    status: 'assessing',
  };
  if (body?.initialAssessmentNotes) updateData.initialAssessmentNotes = String(body.initialAssessmentNotes).trim();
  if (body?.notes) updateData.notes = String(body.notes).trim();

  const updated = await admissionRepo.updateAdmission(admissionId, updateData);

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'SCHEDULE_INITIAL_ASSESSMENT',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: { requestCode: admission.requestCode, status: admission.status },
    afterData: { requestCode: updated.requestCode, status: updated.status, initialAssessmentScheduledAt: scheduledAt },
    req,
  });

  return {
    message: 'Initial assessment scheduled successfully',
    admission: formatAdmission(updated),
  };
};

// ── UC-6.18: Assign Consultant ──────────────────────────────────────────────────
const assignConsultant = async (admin, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Admission request not found', 404);
  }

  if (['cancelled', 'checked_in'].includes(admission.status)) {
    throw new ServiceError(`Cannot assign consultant to admission with status: ${admission.status}`, 400);
  }

  const consultantId = body?.consultantId;
  if (!consultantId) {
    throw new ServiceError('consultantId is required', 400);
  }

  const consultant = await User.findById(consultantId);
  if (!consultant) {
    throw new ServiceError('Consultant user not found', 404);
  }
  if (!['doctor', 'nurse'].includes(consultant.role)) {
    throw new ServiceError('Consultant must be a doctor or nurse', 400);
  }

  // Anti-spam: Chặn gán lại cùng consultant
  if (admission.consultantId && String(admission.consultantId) === String(consultant._id)) {
    throw new ServiceError(
      `Nhân viên '${consultant.fullName}' đã được chỉ định làm tư vấn cho hồ sơ này rồi.`,
      409
    );
  }

  const updated = await admissionRepo.updateAdmission(admissionId, {
    consultantId: consultant._id,
  });

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'ASSIGN_CONSULTANT',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: { requestCode: admission.requestCode, consultantId: admission.consultantId },
    afterData: { requestCode: updated.requestCode, consultantId: consultant._id, consultantName: consultant.fullName },
    req,
  });

  return {
    message: 'Consultant assigned successfully',
    admission: formatAdmission(updated),
  };
};

// ── UC-6.19: Evaluate Admission Eligibility ─────────────────────────────────────
const evaluateAdmissionEligibility = async (doctor, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Admission request not found', 404);
  }

  if (!['new_request', 'consulting', 'assessing', 'contracting'].includes(admission.status)) {
    throw new ServiceError(
      `Cannot evaluate eligibility for admission with status: ${admission.status}. Only new_request, consulting, assessing, contracting are allowed.`,
      400
    );
  }

  const eligibilityStatus = body?.eligibilityStatus;
  if (!eligibilityStatus || !['eligible', 'not_eligible'].includes(eligibilityStatus)) {
    throw new ServiceError(`eligibilityStatus phải là 'eligible' hoặc 'not_eligible'. Bác sĩ cần đưa ra kết luận rõ ràng khi đánh giá điều kiện nhập viện.`, 400);
  }

  const assessmentResult = body?.assessmentResult?.trim();
  if (!assessmentResult) {
    throw new ServiceError('assessmentResult is required', 400);
  }

  const updateData = {
    eligibilityStatus,
    assessmentResult,
    assessedBy: doctor._id,
    assessedAt: new Date(),
  };

  if (eligibilityStatus === 'not_eligible') {
    updateData.status = 'cancelled';
    updateData.rejectionReason = body?.rejectionReason?.trim() || `Not eligible: ${assessmentResult}`;
    updateData.rejectedAt = new Date();
    updateData.cancelledAt = new Date();
    updateData.cancellationReason = `[Doctor evaluation] ${updateData.rejectionReason}`;
  } else if (eligibilityStatus === 'eligible') {
    updateData.status = 'contracting';

    // Auto-assign resident to the doctor/nurse's assignedResidentIds so they can monitor in "Theo dõi sức khỏe"
    try {
      const residentId = admission.residentId?._id || admission.residentId;
      if (residentId) {
        const ridStr = residentId.toString();
        const staffProfileRepo = require('../repositories/staffProfileRepository');
        
        const addResidentToStaff = async (profile) => {
          if (!profile) return;
          const currentIds = (profile.assignedResidentIds || []).map(id => id.toString());
          if (!currentIds.includes(ridStr)) {
            const newIds = [...(profile.assignedResidentIds || []), residentId];
            await staffProfileRepo.updateById(profile._id, { assignedResidentIds: newIds });
          }
        };

        // 1. Logged in doctor/nurse who evaluated the request
        const evaluatorProfile = await staffProfileRepo.findByUserId(doctor._id);
        await addResidentToStaff(evaluatorProfile);

        // 2. Doctor/Nurse assigned to the intake Care Appointment
        const appt = await CareAppointment.findOne({
          residentId: residentId,
          appointmentType: 'Khám lâm sàng đầu vào'
        });
        if (appt) {
          if (appt.doctorStaffId) {
            const docProfile = await staffProfileRepo.findById(appt.doctorStaffId);
            await addResidentToStaff(docProfile);
          }
          if (appt.nurseStaffId) {
            const nurProfile = await staffProfileRepo.findById(appt.nurseStaffId);
            await addResidentToStaff(nurProfile);
          }
        }
      }
    } catch (err) {
      console.error('Failed to automatically assign resident to staff assigned list:', err);
    }
  }

  if (body?.notes) updateData.notes = String(body.notes).trim();

  const updated = await admissionRepo.updateAdmission(admissionId, updateData);

  await createAuditLog({
    actorUserId: doctor._id,
    actorRole: doctor.role,
    action: 'EVALUATE_ADMISSION_ELIGIBILITY',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: { requestCode: admission.requestCode, status: admission.status, eligibilityStatus: admission.eligibilityStatus },
    afterData: { requestCode: updated.requestCode, status: updated.status, eligibilityStatus: updated.eligibilityStatus, assessmentResult },
    req,
  });

  return {
    message: eligibilityStatus === 'eligible'
      ? 'Resident is eligible for admission'
      : 'Resident is not eligible for admission',
    admission: formatAdmission(updated),
  };
};

// ── UC-6.24: Assign Service Package ─────────────────────────────────────────────
const assignServicePackage = async (admin, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Admission request not found', 404);
  }

  if (!['assessing', 'contracting'].includes(admission.status)) {
    throw new ServiceError(
      `Cannot assign service package to admission with status: ${admission.status}. Only assessing, contracting are allowed.`,
      400
    );
  }

  const servicePackageId = body?.servicePackageId;
  if (!servicePackageId) {
    throw new ServiceError('servicePackageId is required', 400);
  }

  const pkg = await servicePackageRepo.findById(servicePackageId);
  if (!pkg) {
    throw new ServiceError('Service package not found', 404);
  }
  if (!pkg.isActive) {
    throw new ServiceError('Cannot assign an inactive service package', 400);
  }

  const updateData = {
    servicePackageId: pkg._id,
    assignedServicePackage: pkg.name,
  };

  const contractDurationMonths = body?.contractDurationMonths !== undefined && body.contractDurationMonths !== null
    ? Number(body.contractDurationMonths)
    : undefined;
  if (contractDurationMonths !== undefined) {
    if (!Number.isFinite(contractDurationMonths) || contractDurationMonths < 1) {
      throw new ServiceError('contractDurationMonths must be a positive number', 400);
    }
    updateData.contractDurationMonths = Math.floor(contractDurationMonths);
  }

  const contractDiscountPercent = body?.contractDiscountPercent !== undefined && body.contractDiscountPercent !== null
    ? Number(body.contractDiscountPercent)
    : body?.discountPercent !== undefined && body.discountPercent !== null
      ? Number(body.discountPercent)
      : undefined;
  if (contractDiscountPercent !== undefined) {
    if (!Number.isFinite(contractDiscountPercent) || contractDiscountPercent < 0 || contractDiscountPercent > 100) {
      throw new ServiceError('contractDiscountPercent must be a number between 0 and 100', 400);
    }
    updateData.contractDiscountPercent = Math.round(contractDiscountPercent * 100) / 100;
  }

  const updated = await admissionRepo.updateAdmission(admissionId, updateData);

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'ASSIGN_SERVICE_PACKAGE',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: {
      requestCode: admission.requestCode,
      servicePackageId: admission.servicePackageId,
      assignedServicePackage: admission.assignedServicePackage,
      contractDurationMonths: admission.contractDurationMonths,
      contractDiscountPercent: admission.contractDiscountPercent,
    },
    afterData: {
      requestCode: updated.requestCode,
      servicePackageId: pkg._id,
      assignedServicePackage: pkg.name,
      contractDurationMonths: updated.contractDurationMonths,
      contractDiscountPercent: updated.contractDiscountPercent,
    },
    req,
  });

  return {
    message: 'Service package assigned successfully',
    admission: formatAdmission(updated),
  };
};

// ── UC-6.25: Create Admission Contract ──────────────────────────────────────────
const createAdmissionContract = async (admin, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Admission request not found', 404);
  }

  if (!['assessing', 'contracting'].includes(admission.status)) {
    throw new ServiceError(
      `Cannot create contract for admission with status: ${admission.status}. Only assessing, contracting are allowed.`,
      400
    );
  }

  const contractNumber = body?.contractNumber?.trim();
  if (!contractNumber) {
    throw new ServiceError('contractNumber is required', 400);
  }

  // Anti-spam: Nếu hồ sơ đã có số hợp đồng, chặn tạo trùng
  if (admission.contractNumber && admission.contractNumber === contractNumber) {
    throw new ServiceError(
      `Hợp đồng số '${contractNumber}' đã được tạo cho hồ sơ này rồi. Không cần tạo lại.`,
      409
    );
  }

  const contractStartDate = body?.contractStartDate ? new Date(body.contractStartDate) : null;
  const contractEndDate = body?.contractEndDate ? new Date(body.contractEndDate) : null;
  const contractDurationMonths = body?.contractDurationMonths !== undefined && body.contractDurationMonths !== null
    ? Number(body.contractDurationMonths)
    : undefined;
  const contractDiscountPercent = body?.contractDiscountPercent !== undefined && body.contractDiscountPercent !== null
    ? Number(body.contractDiscountPercent)
    : body?.discountPercent !== undefined && body.discountPercent !== null
      ? Number(body.discountPercent)
      : undefined;

  if (contractStartDate && Number.isNaN(contractStartDate.getTime())) {
    throw new ServiceError('contractStartDate is invalid', 400);
  }
  if (contractEndDate && Number.isNaN(contractEndDate.getTime())) {
    throw new ServiceError('contractEndDate is invalid', 400);
  }
  if (contractStartDate && contractEndDate && contractEndDate <= contractStartDate) {
    throw new ServiceError('contractEndDate must be after contractStartDate', 400);
  }
  if (contractDurationMonths !== undefined) {
    if (!Number.isFinite(contractDurationMonths) || contractDurationMonths < 1) {
      throw new ServiceError('contractDurationMonths must be a positive number', 400);
    }
  }
  if (contractDiscountPercent !== undefined) {
    if (!Number.isFinite(contractDiscountPercent) || contractDiscountPercent < 0 || contractDiscountPercent > 100) {
      throw new ServiceError('contractDiscountPercent must be a number between 0 and 100', 400);
    }
  }

  const updateData = {
    contractNumber,
    contractSignedAt: new Date(),
    status: 'contracting',
  };
  if (contractStartDate) updateData.contractStartDate = contractStartDate;
  if (contractEndDate) updateData.contractEndDate = contractEndDate;
  if (contractDurationMonths !== undefined) updateData.contractDurationMonths = Math.floor(contractDurationMonths);
  if (contractDiscountPercent !== undefined) updateData.contractDiscountPercent = Math.round(contractDiscountPercent * 100) / 100;
  if (body?.contractTerms) updateData.contractTerms = String(body.contractTerms).trim();
  if (body?.notes) updateData.notes = String(body.notes).trim();

  const updated = await admissionRepo.updateAdmission(admissionId, updateData);

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'CREATE_ADMISSION_CONTRACT',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: {
      requestCode: admission.requestCode,
      status: admission.status,
      contractDurationMonths: admission.contractDurationMonths,
      contractDiscountPercent: admission.contractDiscountPercent,
    },
    afterData: {
      requestCode: updated.requestCode,
      status: updated.status,
      contractNumber,
      contractDurationMonths: updated.contractDurationMonths,
      contractDiscountPercent: updated.contractDiscountPercent,
    },
    req,
  });

  return {
    message: 'Admission contract created successfully',
    admission: formatAdmission(updated),
  };
};

// ── UC-6.26: Check-in Resident ──────────────────────────────────────────────────
const generateResidentCode = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `RES${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const exists = await Resident.findOne({ residentCode: code });
    if (!exists) return code;
  }
  throw new ServiceError('Unable to generate resident code', 500);
};

const checkInResident = async (admin, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Admission request not found', 404);
  }

  if (admission.status !== 'contracting') {
    throw new ServiceError(
      `Cannot check in resident with admission status: ${admission.status}. Only contracting is allowed.`,
      400
    );
  }

  if (!admission.contractNumber) {
    throw new ServiceError('Admission must have a contract before check-in', 400);
  }

  // Validate bed & room if provided
  let assignedBedId = body?.bedId || null;
  let assignedRoomId = body?.roomId || null;

  if (assignedBedId) {
    const bed = await Bed.findById(assignedBedId);
    if (!bed) throw new ServiceError('Bed not found', 404);
    if (bed.status !== 'available') throw new ServiceError('Bed is not available', 400);
    assignedRoomId = assignedRoomId || bed.roomId;
  }

  if (assignedRoomId) {
    const room = await Room.findById(assignedRoomId);
    if (!room) throw new ServiceError('Room not found', 404);
  }

  // Create or update Resident
  let resident;
  if (admission.residentId) {
    resident = await Resident.findById(admission.residentId);
    if (resident) {
      resident.residencyStatus = 'admitted';
      resident.admittedAt = new Date();
      if (assignedBedId) resident.bedId = assignedBedId;
      if (assignedRoomId) resident.roomId = assignedRoomId;
      if (admission.assignedServicePackage) resident.servicePackage = admission.assignedServicePackage;
      await resident.save();
    }
  }

  if (!resident) {
    const residentCode = await generateResidentCode();
    const applicant = admission.applicant || {};
    resident = await Resident.create({
      residentCode,
      fullName: applicant.fullName || 'Unknown',
      dateOfBirth: applicant.dateOfBirth,
      gender: applicant.gender || 'unknown',
      citizenId: applicant.citizenId,
      bloodType: applicant.bloodType || 'unknown',
      personalAddress: applicant.personalAddress,
      allergies: applicant.allergies || [],
      chronicConditions: applicant.chronicConditions || [],
      initialHealthCondition: applicant.initialHealthCondition,
      bedId: assignedBedId,
      roomId: assignedRoomId,
      residencyStatus: 'admitted',
      admittedAt: new Date(),
      servicePackage: admission.assignedServicePackage,
      familyPortalAccountIds: [admission.familyAccountId],
    });
  }

  // Update bed status and room occupancy
  if (assignedBedId) {
    const bedRepo = require('../repositories/bedRepository');
    await bedRepo.occupyBed(assignedBedId, resident._id, new Date());
  }

  if (assignedRoomId) {
    const roomRepo = require('../repositories/roomRepository');
    await roomRepo.adjustOccupiedCount(assignedRoomId, 1);
  }

  const updated = await admissionRepo.updateAdmission(admissionId, {
    status: 'checked_in',
    checkInAt: new Date(),
    residentId: resident._id,
    assignedBedId,
    assignedRoomId,
  });

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'CHECK_IN_RESIDENT',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: { requestCode: admission.requestCode, status: admission.status },
    afterData: { requestCode: updated.requestCode, status: updated.status, residentId: resident._id, residentCode: resident.residentCode },
    req,
  });

  return {
    message: 'Resident checked in successfully',
    admission: formatAdmission(updated),
    resident: {
      _id: resident._id,
      residentCode: resident.residentCode,
      fullName: resident.fullName,
      residencyStatus: resident.residencyStatus,
    },
  };
};

/**
 * Extend the contract end date for an admission.
 * @param {object} admin - User making the request
 * @param {string} admissionId - Admission MongoDB ObjectId
 * @param {object} body - Request body
 * @param {string} body.contractEndDate - New contract end date (ISO 8601 format)
 * @returns {object} { message, admission }
 */
const extendAdmissionContract = async (admin, admissionId, body) => {
  const { contractEndDate } = body;

  // Validate input
  if (!contractEndDate) {
    throw { statusCode: 400, message: 'contractEndDate is required' };
  }

  const newEndDate = new Date(contractEndDate);
  if (isNaN(newEndDate.getTime())) {
    throw { statusCode: 400, message: 'Invalid contractEndDate format' };
  }

  // Find admission
  const admission = await admissionRepo.findByIdForAdmin(admissionId);
  if (!admission) {
    throw { statusCode: 404, message: 'Admission not found' };
  }

  // Verify current date is before new end date
  const now = new Date();
  if (newEndDate <= now) {
    throw { statusCode: 400, message: 'New contract end date must be in the future' };
  }

  // Update contract end date
  const oldEndDate = admission.contractEndDate;
  admission.contractEndDate = newEndDate;
  const updated = await admission.save();

  // Log action
  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'EXTEND_CONTRACT',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: { contractEndDate: oldEndDate?.toISOString?.() },
    afterData: { contractEndDate: newEndDate.toISOString() },
  });

  return {
    message: 'Contract extended successfully',
    admission: formatAdmission(updated),
  };
};

module.exports = {
  submitAdmissionRequest,
  listAdmissionHistory,
  getAdmissionRequest,
  cancelAdmissionRequest,
  adminListAdmissions,
  adminGetAdmission,
  approveAdmission,
  rejectAdmission,
  preAdmissionConsultation,
  scheduleInitialAssessment,
  assignConsultant,
  evaluateAdmissionEligibility,
  assignServicePackage,
  createAdmissionContract,
  checkInResident,
  extendAdmissionContract,
};


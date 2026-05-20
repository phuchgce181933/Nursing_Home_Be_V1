const ServiceError = require('./serviceError');
const admissionRepo = require('../repositories/admissionRepository');
const { GENDERS, BLOOD_TYPES, ADMISSION_STATUSES } = require('../models/enums');
const { createAuditLog } = require('../utils/auditLog');

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const formatAdmission = (admission, { includeFamily = false } = {}) => {
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
    };
  }

  return base;
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
  await admission.populate('residentId', 'residentCode fullName residencyStatus');
  return { admission: formatAdmission(admission) };
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
const adminListAdmissions = async (query) => {
  const filter = {};

  if (query.status) {
    if (!ADMISSION_STATUSES.includes(query.status)) {
      throw new ServiceError(`status must be one of: ${ADMISSION_STATUSES.join(', ')}`, 400);
    }
    filter.status = query.status;
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

  return {
    data: data.map((a) => formatAdmission(a, { includeFamily: true })),
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  };
};

const adminGetAdmission = async (admissionId) => {
  const admission = await admissionRepo.findByIdForAdmin(admissionId);
  if (!admission) {
    throw new ServiceError('Admission request not found', 404);
  }
  return { admission: formatAdmission(admission, { includeFamily: true }) };
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

  const nextStatus = 'contracting';
  const updateData = {
    status: nextStatus,
    eligibilityStatus: 'eligible',
    approvedAt: new Date(),
  };

  if (body?.notes) updateData.notes = String(body.notes).trim();
  if (body?.assignedServicePackage) updateData.assignedServicePackage = String(body.assignedServicePackage).trim();

  const updated = await admissionRepo.updateAdmission(admissionId, updateData);

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'APPROVE_ADMISSION_REQUEST',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: { requestCode: admission.requestCode, status: admission.status, eligibilityStatus: admission.eligibilityStatus },
    afterData: { requestCode: updated.requestCode, status: updated.status, eligibilityStatus: updated.eligibilityStatus },
    req,
  });

  return {
    message: 'Admission request approved successfully',
    admission: formatAdmission(updated, { includeFamily: false }),
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
    admission: formatAdmission(updated, { includeFamily: false }),
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
};

const ServiceError = require('./serviceError');
const admissionRepo = require('../repositories/admissionRepository');
const { GENDERS, BLOOD_TYPES, ADMISSION_STATUSES, ADMISSION_ELIGIBILITY_STATUSES } = require('../models/enums');
const { createAuditLog } = require('../utils/auditLog');
const User = require('../models/user');
const Resident = require('../models/resident');
const Bed = require('../models/bed');
const Room = require('../models/room');
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
      ? { _id: admission.consultedBy._id, fullName: admission.consultedBy.fullName, role: admission.consultedBy.role }
      : admission.consultedBy || null,
    consultedAt: admission.consultedAt,
    consultantId: admission.consultantId?._id
      ? { _id: admission.consultantId._id, fullName: admission.consultantId.fullName, role: admission.consultantId.role }
      : admission.consultantId || null,
    consultationScheduledAt: admission.consultationScheduledAt,
    initialAssessmentScheduledAt: admission.initialAssessmentScheduledAt,
    initialAssessmentNotes: admission.initialAssessmentNotes,
    assessmentResult: admission.assessmentResult,
    assessedBy: admission.assessedBy?._id
      ? { _id: admission.assessedBy._id, fullName: admission.assessedBy.fullName, role: admission.assessedBy.role }
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
    contractTerms: admission.contractTerms,
    assignedBedId: admission.assignedBedId || null,
    assignedRoomId: admission.assignedRoomId || null,
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

  if (!['new_request', 'consulting'].includes(admission.status)) {
    throw new ServiceError(
      `Cannot perform consultation on admission with status: ${admission.status}. Only new_request, consulting are allowed.`,
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
    status: 'consulting',
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

  if (!['consulting', 'assessing'].includes(admission.status)) {
    throw new ServiceError(
      `Cannot evaluate eligibility for admission with status: ${admission.status}. Only consulting, assessing are allowed.`,
      400
    );
  }

  const eligibilityStatus = body?.eligibilityStatus;
  if (!eligibilityStatus || !ADMISSION_ELIGIBILITY_STATUSES.includes(eligibilityStatus)) {
    throw new ServiceError(`eligibilityStatus is required and must be one of: ${ADMISSION_ELIGIBILITY_STATUSES.join(', ')}`, 400);
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

  const updated = await admissionRepo.updateAdmission(admissionId, {
    servicePackageId: pkg._id,
    assignedServicePackage: pkg.name,
  });

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'ASSIGN_SERVICE_PACKAGE',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: { requestCode: admission.requestCode, servicePackageId: admission.servicePackageId, assignedServicePackage: admission.assignedServicePackage },
    afterData: { requestCode: updated.requestCode, servicePackageId: pkg._id, assignedServicePackage: pkg.name },
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

  if (contractStartDate && Number.isNaN(contractStartDate.getTime())) {
    throw new ServiceError('contractStartDate is invalid', 400);
  }
  if (contractEndDate && Number.isNaN(contractEndDate.getTime())) {
    throw new ServiceError('contractEndDate is invalid', 400);
  }
  if (contractStartDate && contractEndDate && contractEndDate <= contractStartDate) {
    throw new ServiceError('contractEndDate must be after contractStartDate', 400);
  }

  const updateData = {
    contractNumber,
    contractSignedAt: new Date(),
    status: 'contracting',
  };
  if (contractStartDate) updateData.contractStartDate = contractStartDate;
  if (contractEndDate) updateData.contractEndDate = contractEndDate;
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
    beforeData: { requestCode: admission.requestCode, status: admission.status },
    afterData: { requestCode: updated.requestCode, status: updated.status, contractNumber },
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

  // Update bed status
  if (assignedBedId) {
    await Bed.findByIdAndUpdate(assignedBedId, { status: 'occupied' });
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
};

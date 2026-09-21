const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ServiceError = require('./serviceError');
const admissionRepo = require('../repositories/admissionRepository');
const invoiceRepo = require('../repositories/invoiceRepository');
const { GENDERS, BLOOD_TYPES, ADMISSION_STATUSES, ADMISSION_ELIGIBILITY_STATUSES } = require('../models/enums');
const { createAuditLog } = require('../utils/auditLog');
const { validatePhone, validateEmail } = require('../utils/validators');
const mailService = require('./mailService');
const userRepo = require('../repositories/userRepository');
const residentRepo = require('../repositories/residentRepository');
const careAppointmentRepo = require('../repositories/careAppointmentRepository');
const servicePackageRepo = require('../repositories/servicePackageRepository');
const bedRepo = require('../repositories/bedRepository');
const roomRepo = require('../repositories/roomRepository');
const walletService = require('./walletService');
const paymentRepo = require('../repositories/paymentRepository');
const contractService = require('./contractService');
const contractInvoiceService = require('./contractInvoiceService');
const contractRepo = require('../repositories/contractRepository');

const MAX_TEXT_LENGTH = 500;
const CITIZEN_ID_REGEX = /^(\d{12}|[A-Za-z0-9]{8,12})$/;

const assertMaxLength = (value, fieldName, max = MAX_TEXT_LENGTH) => {
  if (value && value.length > max) {
    throw new ServiceError(`${fieldName} phải có tối đa ${max} ký tự`, 400);
  }
};

const getStartOfTodayVN = () => {
  const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate(), 0, 0, 0, 0) - 7 * 60 * 60 * 1000
  );
};

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const formatAdmission = (admission, { includeFamily = true } = {}) => {
  const applicantObj = admission.applicant
    ? (typeof admission.applicant.toObject === 'function' ? admission.applicant.toObject() : { ...admission.applicant })
    : {};

  if (!applicantObj.avatarUrl && admission.residentId?.avatarUrl) {
    applicantObj.avatarUrl = admission.residentId.avatarUrl;
  }

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
          avatarUrl: admission.residentId.avatarUrl || null,
        }
      : null,
    applicant: applicantObj,
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
    contractStatus: admission.contractStatus,
    contractCancelledAt: admission.contractCancelledAt,
    contractCancellationReason: admission.contractCancellationReason,
    cancelledAt: admission.cancelledAt,
    cancellationReason: admission.cancellationReason,
    assignedBedId: admission.assignedBedId?._id || admission.assignedBedId || null,
    assignedBed: admission.assignedBedId?.bedCode
      ? { _id: admission.assignedBedId._id, bedCode: admission.assignedBedId.bedCode }
      : null,
    assignedRoomId: admission.assignedRoomId?._id || admission.assignedRoomId || null,
    assignedRoom: admission.assignedRoomId?.roomNumber
      ? { _id: admission.assignedRoomId._id, roomNumber: admission.assignedRoomId.roomNumber }
      : null,
    checkInAt: admission.checkInAt,
    cancellationReason: admission.cancellationReason,
    rejectionReason: admission.rejectionReason,
    rejectedAt: admission.rejectedAt,
    approvedAt: admission.approvedAt,
    notes: admission.notes,
    createdAt: admission.createdAt,
    updatedAt: admission.updatedAt,
  };

  if (includeFamily && admission.familyAccountId && typeof admission.familyAccountId === 'object') {
    base.familyAccount = {
      _id: admission.familyAccountId._id,
      fullName: admission.familyAccountId.fullName,
      email: admission.familyAccountId.email,
      phone: admission.familyAccountId.phone,
      username: admission.familyAccountId.username || 'N/A',
      avatarUrl: admission.familyAccountId.avatarUrl || null,
    };
  }

  return base;
};

const getCareAppointmentForResident = async (residentId, admissionId) => {
  if (!residentId) return null;
  try {
    const careAppt = await careAppointmentRepo.findOneByFilter(
      admissionId
        ? { $or: [{ admissionId }, { residentId, appointmentType: 'Khám lâm sàng đầu vào' }] }
        : { residentId, appointmentType: 'Khám lâm sàng đầu vào' },
      { populate: [
        { path: 'doctorStaffId', populate: { path: 'userId', select: 'fullName email' } },
        { path: 'nurseStaffId', populate: { path: 'userId', select: 'fullName email' } },
      ] }
    );

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
  throw new ServiceError('Không thể tạo mã yêu cầu', 500);
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
      `applicant.fullName là bắt buộc. Các khóa nhận được trong applicant: ${receivedKeys}. Vui lòng gửi JSON body với Content-Type: application/json.`,
      400
    );
  }

  const relationship = (applicant.relationshipToRequester || relationshipToRequester)?.trim();
  if (!relationship) {
    throw new ServiceError('applicant.relationshipToRequester là bắt buộc', 400);
  }

  if (applicant.gender && !GENDERS.includes(applicant.gender)) {
    throw new ServiceError(`applicant.gender phải thuộc một trong: ${GENDERS.join(', ')}`, 400);
  }
  if (applicant.bloodType && !BLOOD_TYPES.includes(applicant.bloodType)) {
    throw new ServiceError(`applicant.bloodType phải thuộc một trong: ${BLOOD_TYPES.join(', ')}`, 400);
  }

  const citizenId = applicant.citizenId?.trim();
  if (citizenId && !CITIZEN_ID_REGEX.test(citizenId)) {
    throw new ServiceError('applicant.citizenId phải là CCCD 12 chữ số hoặc số hộ chiếu 8-12 ký tự chữ và số', 400);
  }

  assertMaxLength(applicant.initialHealthCondition?.trim(), 'applicant.initialHealthCondition');

  const dateOfBirth = applicant.dateOfBirth ? new Date(applicant.dateOfBirth) : undefined;
  if (applicant.dateOfBirth && Number.isNaN(dateOfBirth?.getTime())) {
    throw new ServiceError('applicant.dateOfBirth không hợp lệ', 400);
  }
  if (dateOfBirth) {
    const today = new Date();
    let age = today.getFullYear() - dateOfBirth.getFullYear();
    const m = today.getMonth() - dateOfBirth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dateOfBirth.getDate())) {
      age--;
    }
    if (age < 50) {
      throw new ServiceError('Người được đăng ký nhập viện phải từ 50 tuổi trở lên', 400);
    }
  }

  const phone = applicant.phone ? String(applicant.phone).trim() : undefined;
  if (phone && !/^(0|\+84)(3|5|7|8|9)\d{8}$/.test(phone)) {
    throw new ServiceError('Số điện thoại liên hệ của người cao tuổi không hợp lệ', 400);
  }
  const avatarUrl = applicant.avatarUrl ? String(applicant.avatarUrl).trim() : undefined;

  return {
    fullName,
    dateOfBirth,
    gender: applicant.gender || 'unknown',
    citizenId,
    bloodType: applicant.bloodType || 'unknown',
    personalAddress: applicant.personalAddress?.trim(),
    relationshipToRequester: relationship,
    allergies: normalizeStringArray(applicant.allergies),
    chronicConditions: normalizeStringArray(applicant.chronicConditions),
    initialHealthCondition: applicant.initialHealthCondition?.trim(),
    phone,
    avatarUrl,
  };
};

const submitAdmissionRequest = async (user, body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    throw new ServiceError(
      'Nội dung yêu cầu trống hoặc chưa được phân tích. Vui lòng dùng POST với Header Content-Type: application/json và Body type raw → JSON.',
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
    throw new ServiceError('applicant object là bắt buộc trong request body', 400);
  }

  // Handle base64 avatar upload for applicant
  let uploadedAvatarUrl = applicant?.avatarUrl;
  if (uploadedAvatarUrl && uploadedAvatarUrl.startsWith('data:image/')) {
    try {
      const { uploadImageBuffer } = require('../utils/cloudinaryUpload');
      const matches = uploadedAvatarUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const mimeType = matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const uploadResult = await uploadImageBuffer(buffer, {
          folder: 'nursing-home/elderly',
          mimeType,
        });
        uploadedAvatarUrl = uploadResult.secure_url;
      }
    } catch (uploadErr) {
      console.error('Failed to upload applicant avatar to Cloudinary:', uploadErr);
      throw new ServiceError('Không thể tải ảnh đại diện lên Cloudinary: ' + uploadErr.message, 400);
    }
  }

  const applicantCopy = applicant ? { ...applicant, avatarUrl: uploadedAvatarUrl } : null;

  let resolvedApplicant;
  let resolvedResidentId = residentId || null;

  if (resolvedResidentId) {
    const resident = await admissionRepo.assertFamilyResidentAccess(user._id, resolvedResidentId);
    if (!resident) {
      throw new ServiceError('Truy cập bị từ chối: cư dân không được liên kết với tài khoản của bạn', 403);
    }
    if (resident.residencyStatus === 'admitted') {
      throw new ServiceError('Cư dân này đã được tiếp nhận', 400);
    }

    const activeForResident = await admissionRepo.findActiveAdmission({ residentId: resolvedResidentId });
    if (activeForResident) {
      throw new ServiceError('Đã tồn tại yêu cầu nhập viện đang hoạt động cho cư dân này', 409);
    }

    resolvedApplicant = buildApplicant(
      applicantCopy || {
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
    resolvedApplicant = buildApplicant(applicantCopy, relationshipToRequester);

    const duplicateFilter = {
      familyAccountId: user._id,
      'applicant.fullName': resolvedApplicant.fullName,
    };
    if (resolvedApplicant.citizenId) {
      duplicateFilter['applicant.citizenId'] = resolvedApplicant.citizenId;
    }
    const activeDuplicate = await admissionRepo.findActiveAdmission(duplicateFilter);
    if (activeDuplicate) {
      throw new ServiceError('Bạn đã có yêu cầu nhập viện đang chờ xử lý cho người này', 409);
    }
  }

  let preferredDate;
  if (preferredAdmissionDate) {
    preferredDate = new Date(preferredAdmissionDate);
    if (Number.isNaN(preferredDate.getTime())) {
      throw new ServiceError('preferredAdmissionDate không hợp lệ', 400);
    }
    if (preferredDate < getStartOfTodayVN()) {
      throw new ServiceError('preferredAdmissionDate phải là hôm nay hoặc trong tương lai', 400);
    }
  }

  if (requestedByPhone) {
    const phoneError = validatePhone(requestedByPhone.trim());
    if (phoneError) throw new ServiceError(`requestedByPhone: ${phoneError}`, 400);
  }

  assertMaxLength(reasonForAdmission?.trim(), 'reasonForAdmission');
  assertMaxLength(notes?.trim(), 'notes');

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
    message: 'Đã gửi yêu cầu nhập viện thành công',
    admission: formatAdmission(admission),
  };
};

// Front-desk staff create this on behalf of a walk-in family that hasn't
// registered an account yet — familyAccountId stays unset until checkInResident
// auto-provisions one (see there for why: the family only needs login access
// once the resident is actually admitted, not for every earlier pipeline stage).
const createWalkInAdmission = async (admin, body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    throw new ServiceError('Nội dung yêu cầu trống hoặc chưa được phân tích. Vui lòng sử dụng Content-Type: application/json.', 400);
  }

  const {
    applicant,
    relationshipToRequester,
    preferredAdmissionDate,
    reasonForAdmission,
    notes,
    requestedByName,
    requestedByPhone,
    requestedByEmail,
  } = body;

  if (!applicant || typeof applicant !== 'object') {
    throw new ServiceError('applicant object là bắt buộc trong request body', 400);
  }

  const resolvedApplicant = buildApplicant(applicant, relationshipToRequester);

  const contactName = requestedByName?.trim();
  if (!contactName) {
    throw new ServiceError('requestedByName là bắt buộc (người thân liên hệ gửi yêu cầu nhập viện này)', 400);
  }

  const contactPhone = requestedByPhone?.trim();
  const contactEmail = requestedByEmail?.trim().toLowerCase();
  if (!contactPhone && !contactEmail) {
    throw new ServiceError('Vui lòng cung cấp requestedByEmail hoặc requestedByPhone cho người thân liên hệ', 400);
  }
  if (contactPhone) {
    const phoneError = validatePhone(contactPhone);
    if (phoneError) throw new ServiceError(`requestedByPhone: ${phoneError}`, 400);
  }
  if (contactEmail) {
    const emailError = validateEmail(contactEmail);
    if (emailError) throw new ServiceError(`requestedByEmail: ${emailError}`, 400);
  }

  let preferredDate;
  if (preferredAdmissionDate) {
    preferredDate = new Date(preferredAdmissionDate);
    if (Number.isNaN(preferredDate.getTime())) {
      throw new ServiceError('preferredAdmissionDate không hợp lệ', 400);
    }
    if (preferredDate < getStartOfTodayVN()) {
      throw new ServiceError('preferredAdmissionDate phải là hôm nay hoặc trong tương lai', 400);
    }
  }

  assertMaxLength(reasonForAdmission?.trim(), 'reasonForAdmission');
  assertMaxLength(notes?.trim(), 'notes');

  const requestCode = await generateRequestCode();
  const admission = await admissionRepo.createAdmission({
    requestCode,
    residentId: null,
    familyAccountId: null,
    applicant: resolvedApplicant,
    preferredAdmissionDate: preferredDate,
    reasonForAdmission: reasonForAdmission?.trim(),
    requestedByName: contactName,
    requestedByPhone: contactPhone,
    requestedByEmail: contactEmail,
    notes: notes?.trim(),
    status: 'new_request',
    eligibilityStatus: 'pending',
  });

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'CREATE_WALK_IN_ADMISSION',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    afterData: {
      requestCode: admission.requestCode,
      status: admission.status,
      applicantName: admission.applicant?.fullName,
      requestedByName: contactName,
    },
    req,
  });

  return {
    message: 'Đã tạo yêu cầu nhập viện trực tiếp thành công',
    admission: formatAdmission(admission),
  };
};

// Public, unauthenticated self-service admission: unlike createWalkInAdmission (staff-entered,
// account provisioned later at check-in), this creates the family account and sends the login
// credentials immediately, since there's no staff member to hand a temp password to in person.
const submitGuestAdmissionRequest = async (body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    throw new ServiceError('Nội dung yêu cầu trống hoặc chưa được phân tích. Vui lòng sử dụng Content-Type: application/json.', 400);
  }

  const {
    applicant,
    relationshipToRequester,
    preferredAdmissionDate,
    reasonForAdmission,
    notes,
    requestedByName,
    requestedByPhone,
    requestedByEmail,
  } = body;

  if (!applicant || typeof applicant !== 'object') {
    throw new ServiceError('applicant object là bắt buộc trong request body', 400);
  }

  const resolvedApplicant = buildApplicant(applicant, relationshipToRequester);

  const contactName = requestedByName?.trim();
  if (!contactName) {
    throw new ServiceError('requestedByName là bắt buộc (người thân liên hệ gửi yêu cầu nhập viện này)', 400);
  }

  const contactPhone = requestedByPhone?.trim();
  const contactEmail = requestedByEmail?.trim().toLowerCase();
  if (!contactPhone && !contactEmail) {
    throw new ServiceError('Vui lòng cung cấp requestedByEmail hoặc requestedByPhone cho người thân liên hệ', 400);
  }
  if (contactPhone) {
    const phoneError = validatePhone(contactPhone);
    if (phoneError) throw new ServiceError(`requestedByPhone: ${phoneError}`, 400);
  }
  if (contactEmail) {
    const emailError = validateEmail(contactEmail);
    if (emailError) throw new ServiceError(`requestedByEmail: ${emailError}`, 400);
  }

  const existing = contactEmail
    ? await userRepo.findOne({ email: contactEmail })
    : await userRepo.findOne({ phone: contactPhone });
  if (existing) {
    throw new ServiceError(
      'Email/số điện thoại này đã có tài khoản — vui lòng đăng nhập để gửi yêu cầu nhập viện',
      409
    );
  }

  let preferredDate;
  if (preferredAdmissionDate) {
    preferredDate = new Date(preferredAdmissionDate);
    if (Number.isNaN(preferredDate.getTime())) {
      throw new ServiceError('preferredAdmissionDate không hợp lệ', 400);
    }
    if (preferredDate < getStartOfTodayVN()) {
      throw new ServiceError('preferredAdmissionDate phải là hôm nay hoặc trong tương lai', 400);
    }
  }

  assertMaxLength(reasonForAdmission?.trim(), 'reasonForAdmission');
  assertMaxLength(notes?.trim(), 'notes');

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const newUser = await userRepo.createUser({
    fullName: contactName,
    email: contactEmail || undefined,
    phone: contactPhone || undefined,
    passwordHash,
    role: 'family',
    isActive: true,
  });

  const requestCode = await generateRequestCode();
  const admission = await admissionRepo.createAdmission({
    requestCode,
    residentId: null,
    familyAccountId: newUser._id,
    applicant: resolvedApplicant,
    preferredAdmissionDate: preferredDate,
    reasonForAdmission: reasonForAdmission?.trim(),
    requestedByName: contactName,
    requestedByPhone: contactPhone,
    requestedByEmail: contactEmail,
    notes: notes?.trim(),
    status: 'new_request',
    eligibilityStatus: 'pending',
  });

  if (contactEmail) {
    await mailService.sendFamilyAccountCreatedEmail({
      to: contactEmail,
      fullName: newUser.fullName,
      residentName: resolvedApplicant.fullName,
      email: contactEmail,
      password: tempPassword,
    }).catch((err) => console.error('Failed to send guest admission account email:', err.message));
  } else if (contactPhone) {
    const loginUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    await mailService.sendTextBeeSms({
      to: contactPhone,
      message: `An Nhien: Tai khoan cua ban da duoc tao de gui yeu cau nhap vien cho ${resolvedApplicant.fullName || ''}. SDT dang nhap: ${contactPhone} - Mat khau tam: ${tempPassword}. Vui long doi mat khau sau khi dang nhap tai ${loginUrl}.`,
    }).catch((err) => console.error('Failed to send guest admission account SMS:', err.message));
  }

  await createAuditLog({
    actorUserId: newUser._id,
    actorRole: newUser.role,
    action: 'SUBMIT_GUEST_ADMISSION_REQUEST',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    afterData: {
      requestCode: admission.requestCode,
      status: admission.status,
      applicantName: admission.applicant?.fullName,
      requestedByName: contactName,
    },
    req,
  });

  return {
    message: 'Đã gửi yêu cầu nhập viện thành công. Thông tin đăng nhập đã được gửi qua email/số điện thoại của bạn.',
    admission: formatAdmission(admission),
  };
};

const listAdmissionHistory = async (user, query) => {
  const filter = {};

  if (query.status) {
    if (!ADMISSION_STATUSES.includes(query.status)) {
      throw new ServiceError(`status phải thuộc một trong: ${ADMISSION_STATUSES.join(', ')}`, 400);
    }
    filter.status = query.status;
  }

  if (query.from || query.to) {
    filter.requestedAt = {};
    if (query.from) {
      const from = new Date(query.from);
      if (Number.isNaN(from.getTime())) throw new ServiceError('from không hợp lệ', 400);
      filter.requestedAt.$gte = from;
    }
    if (query.to) {
      const to = new Date(query.to);
      if (Number.isNaN(to.getTime())) throw new ServiceError('to không hợp lệ', 400);
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
    throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  }
  await admission.populate([
    { path: 'residentId', select: 'residentCode fullName residencyStatus avatarUrl' },
    { path: 'familyAccountId', select: 'fullName email phone username avatarUrl' },
    { path: 'consultantId', select: 'fullName email role' },
    { path: 'consultedBy', select: 'fullName email role' },
    { path: 'assessedBy', select: 'fullName email role' },
    { path: 'servicePackageId', select: 'packageCode name tier monthlyPrice' },
    { path: 'assignedBedId', select: 'bedCode' },
    { path: 'assignedRoomId', select: 'roomNumber' },
  ]);
  const formatted = formatAdmission(admission);
  formatted.assignedCareAppointment = await getCareAppointmentForResident(admission.residentId?._id || admission.residentId, admission._id);
  formatted.latestInvoice = await getLatestInvoiceForResident(admission.residentId?._id || admission.residentId);
  return { admission: formatted };
};

const cancelAdmissionRequest = async (user, admissionId, body, req) => {
  const admission = await admissionRepo.findByIdForFamily(admissionId, user._id);
  if (!admission) {
    throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  }

  if (admission.status === 'cancelled') {
    throw new ServiceError('Yêu cầu nhập viện này đã bị hủy', 400);
  }

  if (admission.status === 'checked_in') {
    throw new ServiceError('Không thể hủy yêu cầu nhập viện đã được nhận vào', 400);
  }

  if (!admissionRepo.CANCELLABLE_STATUSES.includes(admission.status)) {
    throw new ServiceError(`Không thể hủy yêu cầu với trạng thái: ${admission.status}`, 400);
  }

  // Block cancellation if the intake clinical appointment has already been completed by the doctor
  const residentId = admission.residentId?._id || admission.residentId;
  if (residentId) {
    const completedAppt = await careAppointmentRepo.findOneByFilter({
      $or: [{ admissionId: admission._id }, { residentId, appointmentType: 'Khám lâm sàng đầu vào' }],
      status: 'completed',
    });
    if (completedAppt) {
      throw new ServiceError(
        'Không thể hủy yêu cầu nhập viện sau khi bác sĩ đã hoàn thành khám lâm sàng đầu vào. Vui lòng liên hệ ban quản lý để được hỗ trợ.',
        403
      );
    }
  }

  const cancellationReason = body?.cancellationReason?.trim() || '';
  assertMaxLength(cancellationReason, 'cancellationReason');

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
    message: 'Đã hủy yêu cầu nhập viện thành công',
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
        throw new ServiceError(`status phải thuộc một trong: ${ADMISSION_STATUSES.join(', ')}`, 400);
      }
    }
    filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }

  if (query.eligibilityStatus) {
    const { ADMISSION_ELIGIBILITY_STATUSES } = require('../models/enums');
    if (!ADMISSION_ELIGIBILITY_STATUSES.includes(query.eligibilityStatus)) {
      throw new ServiceError(`eligibilityStatus phải thuộc một trong: ${ADMISSION_ELIGIBILITY_STATUSES.join(', ')}`, 400);
    }
    filter.eligibilityStatus = query.eligibilityStatus;
  }

  if (query.from || query.to) {
    filter.requestedAt = {};
    if (query.from) {
      const from = new Date(query.from);
      if (Number.isNaN(from.getTime())) throw new ServiceError('from không hợp lệ', 400);
      filter.requestedAt.$gte = from;
    }
    if (query.to) {
      const to = new Date(query.to);
      if (Number.isNaN(to.getTime())) throw new ServiceError('to không hợp lệ', 400);
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

  const outstandingAmounts = await Promise.all(
    data.map(async (admission) => {
      const residentId = admission.residentId?._id || admission.residentId;
      if (!residentId) return 0;
      const unpaidInvoices = await invoiceRepo.findUnpaidByResidentId(residentId);
      const invoiceOutstandingAmounts = await Promise.all(
        unpaidInvoices.map(async (inv) => {
          if (String(inv.status).toUpperCase() !== 'PARTIALLY_PAID') {
            return Number(inv.totalAmount || 0);
          }
          const payments = await paymentRepo.findByInvoiceId(inv._id);
          const paidAmount = payments.reduce((paymentSum, payment) => paymentSum + Number(payment.amount || 0), 0);
          return Math.max(0, Number(inv.totalAmount || 0) - paidAmount);
        })
      );
      return invoiceOutstandingAmounts.reduce((sum, amount) => sum + amount, 0);
    })
  );

  return {
    data: data.map((a, index) => {
      const formatted = formatAdmission(a, { includeFamily: true });
      formatted.latestInvoice = latestInvoices[index] || null;
      formatted.latestInvoiceStatus = formatted.latestInvoice?.status?.toString().toLowerCase?.() || null;
      formatted.outstandingAmount = outstandingAmounts[index] || 0;
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
    throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  }
  if (user && ['doctor', 'nurse'].includes(user.role)) {
    const medicalStatuses = ADMISSION_STATUSES;
    if (!medicalStatuses.includes(admission.status)) {
      throw new ServiceError('Truy cập bị từ chối: nhân viên y tế chỉ có thể xem các yêu cầu trong giai đoạn được phép', 403);
    }
  }
  const formatted = formatAdmission(admission, { includeFamily: true });
  formatted.assignedCareAppointment = await getCareAppointmentForResident(admission.residentId?._id || admission.residentId, admission._id);
  formatted.latestInvoice = await getLatestInvoiceForResident(admission.residentId?._id || admission.residentId);
  const unpaidInvoices = await invoiceRepo.findUnpaidByResidentId(admission.residentId?._id || admission.residentId);
  const unpaidOutstandingAmounts = await Promise.all(
    unpaidInvoices.map(async (inv) => {
      if (String(inv.status).toUpperCase() !== 'PARTIALLY_PAID') {
        return Number(inv.totalAmount || 0);
      }
      const payments = await paymentRepo.findByInvoiceId(inv._id);
      const paidAmount = payments.reduce((paymentSum, payment) => paymentSum + Number(payment.amount || 0), 0);
      return Math.max(0, Number(inv.totalAmount || 0) - paidAmount);
    })
  );
  formatted.outstandingAmount = unpaidOutstandingAmounts.reduce((sum, amount) => sum + amount, 0);
  return { admission: formatted };
};

const approveAdmission = async (admin, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  }

  if (!admissionRepo.APPROVABLE_STATUSES.includes(admission.status)) {
    throw new ServiceError(
      `Không thể duyệt yêu cầu nhập viện với trạng thái: ${admission.status}. Chỉ cho phép: ${admissionRepo.APPROVABLE_STATUSES.join(', ')}.`,
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
    const resident = await residentRepo.createResident({
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
      // Walk-in admissions don't have a family account yet at this stage
      // (checkInResident provisions one once the resident is actually admitted).
      familyPortalAccountIds: admission.familyAccountId ? [admission.familyAccountId] : [],
      avatarUrl: applicant.avatarUrl,
      phone: applicant.phone,
    });
    residentId = resident._id;
    updateData.residentId = residentId;
  }

  const updated = await admissionRepo.updateAdmission(admissionId, updateData);

  // Automatically create first Care Appointment at UC-12
  // Guard: only create if no intake appointment already exists for this resident
  const existingAppt = await careAppointmentRepo.findOneByFilter({
    $or: [{ admissionId: admission._id }, { residentId, appointmentType: 'Khám lâm sàng đầu vào' }],
    status: { $ne: 'cancelled' },
  });

  if (!existingAppt) {
    const start = admission.preferredAdmissionDate ? new Date(admission.preferredAdmissionDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    start.setHours(8, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour duration

    await careAppointmentRepo.createAppointment({
      residentId: residentId,
      admissionId: admission._id,
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
    message: 'Đã duyệt yêu cầu nhập viện thành công',
    admission: formatAdmission(updated, { includeFamily: true }),
  };
};

const rejectAdmission = async (admin, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  }

  if (!admissionRepo.REJECTABLE_STATUSES.includes(admission.status)) {
    throw new ServiceError(
      `Không thể từ chối yêu cầu nhập viện với trạng thái: ${admission.status}. Chỉ cho phép: ${admissionRepo.REJECTABLE_STATUSES.join(', ')}.`,
      400
    );
  }

  const rejectionReason = body?.rejectionReason?.trim() || '';
  if (!rejectionReason) {
    throw new ServiceError('rejectionReason là bắt buộc khi từ chối yêu cầu nhập viện', 400);
  }
  assertMaxLength(rejectionReason, 'rejectionReason');

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
    message: 'Đã từ chối yêu cầu nhập viện thành công',
    admission: formatAdmission(updated, { includeFamily: true }),
  };
};

// ── UC-6.16: Pre-admission Consultation ─────────────────────────────────────────
const preAdmissionConsultation = async (user, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  }

  // Allow consultation when admission is in any medical phase or contracting/checked_in
  if (!['new_request', 'consulting', 'assessing', 'contracting', 'checked_in'].includes(admission.status)) {
    throw new ServiceError(
      `Không thể thực hiện tư vấn cho yêu cầu nhập viện với trạng thái: ${admission.status}. Chỉ cho phép: new_request, consulting, assessing, contracting, checked_in.`,
      400
    );
  }

  const consultationNotes = body?.consultationNotes?.trim();
  if (!consultationNotes) {
    throw new ServiceError('consultationNotes là bắt buộc', 400);
  }
  assertMaxLength(consultationNotes, 'consultationNotes');
  assertMaxLength(body?.notes?.trim(), 'notes');

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
    message: 'Đã ghi nhận tư vấn trước nhập viện thành công',
    admission: formatAdmission(updated),
  };
};

// ── UC-6.17: Initial Assessment Scheduling ──────────────────────────────────────
const scheduleInitialAssessment = async (user, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  }

  if (!['new_request', 'consulting', 'assessing'].includes(admission.status)) {
    throw new ServiceError(
      `Không thể đặt lịch đánh giá cho yêu cầu nhập viện với trạng thái: ${admission.status}`,
      400
    );
  }

  const scheduledAt = body?.scheduledAt ? new Date(body.scheduledAt) : null;
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    throw new ServiceError('scheduledAt là bắt buộc và phải là ngày hợp lệ', 400);
  }

  if (scheduledAt <= new Date()) {
    throw new ServiceError('scheduledAt phải là ngày trong tương lai', 400);
  }

  assertMaxLength(body?.initialAssessmentNotes?.trim(), 'initialAssessmentNotes');
  assertMaxLength(body?.notes?.trim(), 'notes');

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
    message: 'Đã lên lịch đánh giá ban đầu thành công',
    admission: formatAdmission(updated),
  };
};

// ── UC-6.18: Assign Consultant ──────────────────────────────────────────────────
const assignConsultant = async (admin, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  }

  if (['cancelled', 'checked_in'].includes(admission.status)) {
    throw new ServiceError(`Không thể chỉ định tư vấn viên cho yêu cầu nhập viện với trạng thái: ${admission.status}`, 400);
  }

  const consultantId = body?.consultantId;
  if (!consultantId) {
    throw new ServiceError('consultantId là bắt buộc', 400);
  }

  const consultant = await userRepo.findById(consultantId);
  if (!consultant) {
    throw new ServiceError('Không tìm thấy người dùng tư vấn viên', 404);
  }
  if (!['doctor', 'nurse'].includes(consultant.role)) {
    throw new ServiceError('Tư vấn viên phải là bác sĩ hoặc điều dưỡng', 400);
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
    message: 'Đã phân công tư vấn viên thành công',
    admission: formatAdmission(updated),
  };
};

// ── UC-6.19: Evaluate Admission Eligibility ─────────────────────────────────────
const evaluateAdmissionEligibility = async (doctor, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  }

  if (!['new_request', 'consulting', 'assessing', 'contracting', 'checked_in'].includes(admission.status)) {
    throw new ServiceError(
      `Không thể đánh giá điều kiện nhập viện cho yêu cầu với trạng thái: ${admission.status}. Chỉ cho phép: new_request, consulting, assessing, contracting, checked_in.`,
      400
    );
  }

  const eligibilityStatus = body?.eligibilityStatus;
  if (!eligibilityStatus || !['eligible', 'not_eligible'].includes(eligibilityStatus)) {
    throw new ServiceError(`eligibilityStatus phải là 'eligible' hoặc 'not_eligible'. Bác sĩ cần đưa ra kết luận rõ ràng khi đánh giá điều kiện nhập viện.`, 400);
  }

  const assessmentResult = body?.assessmentResult?.trim();
  if (!assessmentResult) {
    throw new ServiceError('assessmentResult là bắt buộc', 400);
  }
  assertMaxLength(assessmentResult, 'assessmentResult');
  assertMaxLength(body?.rejectionReason?.trim(), 'rejectionReason');
  assertMaxLength(body?.notes?.trim(), 'notes');

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
        const appt = await careAppointmentRepo.findOneByFilter({
          $or: [{ admissionId: admission._id }, { residentId, appointmentType: 'Khám lâm sàng đầu vào' }],
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
    throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  }

  if (!['assessing', 'contracting'].includes(admission.status)) {
    throw new ServiceError(
      `Không thể gán gói dịch vụ cho yêu cầu nhập viện với trạng thái: ${admission.status}. Chỉ cho phép: assessing, contracting.`,
      400
    );
  }

  const servicePackageId = body?.servicePackageId;
  if (!servicePackageId) {
    throw new ServiceError('servicePackageId là bắt buộc', 400);
  }

  const pkg = await servicePackageRepo.findById(servicePackageId);
  if (!pkg) {
    throw new ServiceError('Không tìm thấy gói dịch vụ', 404);
  }
  if (!pkg.isActive) {
    throw new ServiceError('Không thể gán gói dịch vụ đã ngừng hoạt động', 400);
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
      throw new ServiceError('contractDurationMonths phải là số dương', 400);
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
      throw new ServiceError('contractDiscountPercent phải là số trong khoảng từ 0 đến 100', 400);
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
    message: 'Đã gán gói dịch vụ thành công',
    admission: formatAdmission(updated),
  };
};

// ── UC-6.25: Create Admission Contract ──────────────────────────────────────────
const createAdmissionContract = async (admin, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  }

  if (!['assessing', 'contracting'].includes(admission.status)) {
    throw new ServiceError(
      `Không thể tạo hợp đồng cho yêu cầu nhập viện với trạng thái: ${admission.status}. Chỉ cho phép: assessing, contracting.`,
      400
    );
  }

  const contractNumber = body?.contractNumber?.trim();
  if (!contractNumber) {
    throw new ServiceError('contractNumber là bắt buộc', 400);
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
    throw new ServiceError('contractStartDate không hợp lệ', 400);
  }
  if (contractEndDate && Number.isNaN(contractEndDate.getTime())) {
    throw new ServiceError('contractEndDate không hợp lệ', 400);
  }
  if (contractStartDate && contractEndDate && contractEndDate <= contractStartDate) {
    throw new ServiceError('contractEndDate phải sau contractStartDate', 400);
  }
  if (contractStartDate && contractEndDate) {
    const minimumEndDate = new Date(contractStartDate);
    minimumEndDate.setDate(minimumEndDate.getDate() + 30);
    if (contractEndDate < minimumEndDate) {
      throw new ServiceError('Ngày kết thúc hợp đồng phải cách ngày bắt đầu ít nhất 30 ngày.', 400);
    }
  }
  if (contractDurationMonths !== undefined) {
    if (!Number.isFinite(contractDurationMonths) || contractDurationMonths < 1) {
      throw new ServiceError('contractDurationMonths phải là số dương', 400);
    }
  }
  if (contractDiscountPercent !== undefined) {
    if (!Number.isFinite(contractDiscountPercent) || contractDiscountPercent < 0 || contractDiscountPercent > 100) {
      throw new ServiceError('contractDiscountPercent phải là số trong khoảng từ 0 đến 100', 400);
    }
  }
  assertMaxLength(body?.contractTerms?.trim(), 'contractTerms');
  assertMaxLength(body?.notes?.trim(), 'notes');

  // ── Gộp gói dịch vụ cùng lúc tạo hợp đồng ─────────────────────────────────
  let servicePackageIdForUpdate = null;
  if (body?.servicePackageId) {
    // Chỉ gán khi chưa có package nào
    if (!admission.servicePackageId) {
      const pkg = await servicePackageRepo.findById(body.servicePackageId);
      if (!pkg) {
        throw new ServiceError('Không tìm thấy gói dịch vụ', 404);
      }
      if (!pkg.isActive) {
        throw new ServiceError('Gói dịch vụ đã ngừng hoạt động', 400);
      }
      servicePackageIdForUpdate = pkg._id;
    }
    // Nếu đã có package rồi thì bỏ qua (không override)
  }

  const updateData = {
    contractNumber,
    contractStatus: 'active',
    contractSignedAt: new Date(),
    status: 'contracting',
  };
  if (servicePackageIdForUpdate) {
    updateData.servicePackageId = servicePackageIdForUpdate;
  }
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
      servicePackageId: admission.servicePackageId,
      contractDurationMonths: admission.contractDurationMonths,
      contractDiscountPercent: admission.contractDiscountPercent,
    },
    afterData: {
      requestCode: updated.requestCode,
      status: updated.status,
      contractNumber,
      servicePackageId: updated.servicePackageId,
      contractDurationMonths: updated.contractDurationMonths,
      contractDiscountPercent: updated.contractDiscountPercent,
    },
    req,
  });

  return {
    message: 'Đã tạo hợp đồng nhập viện thành công',
    admission: formatAdmission(updated),
  };
};

const generateResidentCode = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `RES${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const exists = await residentRepo.findByResidentCode(code);
    if (!exists) return code;
  }
  throw new ServiceError('Không thể tạo mã cư dân', 500);
};

const generateTempPassword = () =>
  // 10 random bytes → 14-char base64url string, always contains mixed case +
  // digits (good enough entropy for a one-time credential the user must change).
  crypto.randomBytes(10).toString('base64').replace(/[+/=]/g, '').slice(0, 12) + 'A1!';

// Resolves the family account to link on check-in: reuses admission.familyAccountId
// when already set (the normal self-registration flow), reuses an existing User
// found by the walk-in contact's email/phone (avoids duplicate accounts if the
// same family walked in before for a different resident), or creates a brand new
// family account and emails/texts the temporary password to the contact — this is
// the "hoàn tất thủ tục nhập viện thì gửi tài khoản cho người nhà" requirement.
const resolveFamilyAccountForCheckIn = async (admission, residentFullName) => {
  if (admission.familyAccountId) {
    return { userId: admission.familyAccountId, isNew: false };
  }

  const email = admission.requestedByEmail || null;
  const phone = admission.requestedByPhone || null;
  if (!email && !phone) {
    // Nothing to provision from — leave unlinked rather than block check-in.
    return { userId: null, isNew: false };
  }

  const existing = email
    ? await userRepo.findOne({ email })
    : await userRepo.findOne({ phone });
  if (existing) {
    return { userId: existing._id, isNew: false };
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const newUser = await userRepo.createUser({
    fullName: admission.requestedByName || 'Người thân',
    email: email || undefined,
    phone: phone || undefined,
    passwordHash,
    role: 'family',
    isActive: true,
  });

  if (email) {
    await mailService.sendFamilyAccountCreatedEmail({
      to: email,
      fullName: newUser.fullName,
      residentName: residentFullName,
      email,
      password: tempPassword,
    }).catch((err) => console.error('Failed to send family account email:', err.message));
  } else if (phone) {
    const loginUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    await mailService.sendTextBeeSms({
      to: phone,
      message: `An Nhien: Tai khoan cua ban da duoc tao de theo doi nguoi than ${residentFullName || ''}. SDT dang nhap: ${phone} - Mat khau tam: ${tempPassword}. Vui long doi mat khau sau khi dang nhap tai ${loginUrl}.`,
    }).catch((err) => console.error('Failed to send family account SMS:', err.message));
  }

  return { userId: newUser._id, isNew: true };
};

const checkInResident = async (admin, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) {
    throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  }

  if (admission.status !== 'contracting') {
    throw new ServiceError(
      `Không thể nhận cư dân vào ở với trạng thái yêu cầu nhập viện: ${admission.status}. Chỉ cho phép: contracting.`,
      400
    );
  }

  if (!admission.contractNumber) {
    throw new ServiceError('Yêu cầu nhập viện phải có hợp đồng trước khi nhận vào ở', 400);
  }

  // Validate bed & room — bedId is mandatory so no resident is checked in without a bed assignment
  let assignedBedId = body?.bedId || null;
  let assignedRoomId = body?.roomId || null;

  if (!assignedBedId) {
    throw new ServiceError('bedId là bắt buộc để nhận cư dân vào ở', 400);
  }

  if (assignedBedId) {
    const bed = await bedRepo.findById(assignedBedId);
    if (!bed) throw new ServiceError('Không tìm thấy giường', 404);
    if (bed.status !== 'available') throw new ServiceError('Giường không khả dụng', 400);
    assignedRoomId = assignedRoomId || bed.roomId;
  }

  if (assignedRoomId) {
    const room = await roomRepo.findById(assignedRoomId);
    if (!room) throw new ServiceError('Không tìm thấy phòng', 404);

    // Validate loại phòng phù hợp với Gói dịch vụ đã đăng ký
    if (admission.servicePackageId) {
      const servicePackageRepo = require('../repositories/servicePackageRepository');
      const pkg = await servicePackageRepo.findById(admission.servicePackageId);
      if (pkg) {
        const pkgTier = pkg.tier || 'standard';
        const allowedTypes = pkg.allowedRoomTypes?.length
          ? pkg.allowedRoomTypes
          : (pkgTier === 'vip' ? ['icu', 'isolation'] : pkgTier === 'premium' ? ['premium'] : ['standard']);

        if (!allowedTypes.includes(room.roomType)) {
          const typeNames = { standard: 'Standard', premium: 'Premium', icu: 'ICU', isolation: 'Isolation' };
          const allowedStr = allowedTypes.map((t) => typeNames[t] || t).join(' / ');
          throw new ServiceError(
            `Không thể nhận phòng này: Cư dân đăng ký gói '${pkg.name}' (${pkgTier.toUpperCase()}), chỉ được xếp vào phòng loại ${allowedStr}.`,
            400
          );
        }
      }
    }
  }

  // Resolve (or create + notify) the family account before touching the
  // resident record, so both the "resident already exists" and "create new
  // resident" branches below can link it the same way.
  const applicantForAccount = admission.applicant || {};
  const { userId: familyAccountId } = await resolveFamilyAccountForCheckIn(
    admission,
    applicantForAccount.fullName
  );

  // Create or update Resident
  let resident;
  if (admission.residentId) {
    resident = await residentRepo.findById(admission.residentId);
    if (resident) {
      resident.residencyStatus = 'admitted';
      resident.admittedAt = new Date();
      if (assignedBedId) resident.bedId = assignedBedId;
      if (assignedRoomId) resident.roomId = assignedRoomId;
      if (admission.assignedServicePackage) resident.servicePackage = admission.assignedServicePackage;
      if (familyAccountId && !resident.familyPortalAccountIds?.some((id) => String(id) === String(familyAccountId))) {
        resident.familyPortalAccountIds = [...(resident.familyPortalAccountIds || []), familyAccountId];
      }
      await resident.save();
    }
  }

  if (!resident) {
    const residentCode = await generateResidentCode();
    const applicant = admission.applicant || {};
    resident = await residentRepo.createResident({
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
      familyPortalAccountIds: familyAccountId ? [familyAccountId] : [],
      avatarUrl: applicant.avatarUrl,
      phone: applicant.phone,
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
    ...(familyAccountId && !admission.familyAccountId ? { familyAccountId } : {}),
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
    message: 'Đã nhận phòng cho cư dân thành công',
    admission: formatAdmission(updated),
    resident: {
      _id: resident._id,
      residentCode: resident.residentCode,
      fullName: resident.fullName,
      residencyStatus: resident.residencyStatus,
    },
  };
};

const cancelAdmissionContract = async (admin, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  if (!admission.contractNumber) throw new ServiceError('Yêu cầu nhập viện chưa có hợp đồng', 400);
  if (admission.contractStatus === 'cancelled' || !['contracting', 'checked_in'].includes(admission.status)) {
    throw new ServiceError('Chỉ có thể hủy hợp đồng đang hoạt động.', 400);
  }

  const cancellationReason = String(body?.cancellationReason || body?.reason || '').trim();
  if (!cancellationReason) {
    throw new ServiceError('Vui lòng nhập lý do hủy hợp đồng.', 400);
  }

  const updated = await admissionRepo.updateAdmission(admissionId, {
    contractStatus: 'cancelled',
    contractCancelledAt: new Date(),
    contractCancellationReason: cancellationReason,
    status: 'new_request',
  });

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'CANCEL_ADMISSION_CONTRACT',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: {
      requestCode: admission.requestCode,
      status: admission.status,
      contractNumber: admission.contractNumber,
      contractStatus: admission.contractStatus || 'active',
    },
    afterData: {
      requestCode: updated.requestCode,
      status: updated.status,
      contractNumber: updated.contractNumber,
      contractStatus: updated.contractStatus,
      cancellationReason,
    },
    req,
  });

  return { message: 'Hủy hợp đồng thành công.', admission: formatAdmission(updated) };
};

const resolveMonthlyPackagePrice = async (packageRef) => {
  if (!packageRef) return 0;
  if (typeof packageRef === 'object' && packageRef.monthlyPrice != null) {
    return Number(packageRef.monthlyPrice) || 0;
  }

  const pkg = await servicePackageRepo.findById(packageRef);
  return Number(pkg?.monthlyPrice) || 0;
};

const getRemainingContractMonths = (admission) => {
  const contractStartDate = admission?.contractStartDate ? new Date(admission.contractStartDate) : null;
  const contractEndDate = admission?.contractEndDate ? new Date(admission.contractEndDate) : null;
  if (!contractEndDate) return 0;

  const now = new Date();
  const periodStart = contractStartDate && contractStartDate > now ? contractStartDate : now;
  const remainingMs = contractEndDate.getTime() - periodStart.getTime();
  if (remainingMs <= 0) return 0;

  const remainingDays = remainingMs / (1000 * 60 * 60 * 24);
  return Math.max(0, remainingDays / 30);
};

const createChangePackageAdjustmentInvoice = async ({ residentId, familyAccountId, billingPeriodStart, billingPeriodEnd, careServiceCost, admin }) => {
  if (!careServiceCost || careServiceCost === 0) return null;

  const invoice = await invoiceRepo.create({
    invoiceNumber: `INV-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 9000) + 1000}`,
    residentId,
    familyAccountId,
    billingPeriodStart,
    billingPeriodEnd,
    roomCost: 0,
    medicationCost: 0,
    careServiceCost,
    otherCost: 0,
    totalAmount: careServiceCost,
    total: careServiceCost,
    type: 'SERVICE',
    status: 'ISSUED',
    dueDate: billingPeriodEnd || billingPeriodStart,
    issuedAt: new Date(),
    createdAt: new Date(),
  });

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'CREATE_ADMISSION_PACKAGE_CHANGE_ADJUSTMENT_INVOICE',
    module: 'billing',
    targetEntityType: 'Invoice',
    targetEntityId: invoice._id,
    afterData: invoice.toObject(),
  });

  return invoice;
};

const changeContractServicePackage = async (admin, admissionId, body, req) => {
  const admission = await admissionRepo.findById(admissionId);
  if (!admission) throw new ServiceError('Không tìm thấy yêu cầu nhập viện', 404);
  if (!admission.contractNumber) throw new ServiceError('Yêu cầu nhập viện chưa có hợp đồng', 400);
  if (admission.contractStatus === 'cancelled' || !['contracting', 'checked_in'].includes(admission.status)) {
    throw new ServiceError('Không thể đổi gói dịch vụ cho hợp đồng này.', 400);
  }

  const servicePackageId = body?.servicePackageId;
  if (!servicePackageId) throw new ServiceError('Vui lòng chọn gói dịch vụ mới.', 400);
  const servicePackage = await servicePackageRepo.findById(servicePackageId);
  if (!servicePackage) throw new ServiceError('Không tìm thấy gói dịch vụ.', 404);
  if (!servicePackage.isActive) throw new ServiceError('Gói dịch vụ này đã ngừng hoạt động.', 400);

  const residentId = admission.residentId?._id || admission.residentId;
  const resident = residentId ? await residentRepo.findById(residentId) : null;
  if (resident?.roomId) {
    const room = await roomRepo.findById(resident.roomId);
    if (room) {
      const pkgTier = servicePackage.tier || 'standard';
      const allowedTypes = servicePackage.allowedRoomTypes?.length
        ? servicePackage.allowedRoomTypes
        : (pkgTier === 'vip' ? ['icu', 'isolation'] : pkgTier === 'premium' ? ['premium'] : ['standard']);

      if (!allowedTypes.includes(room.roomType)) {
        const typeNames = { standard: 'Standard', premium: 'Premium', icu: 'ICU', isolation: 'Isolation' };
        const allowedStr = allowedTypes.map((t) => typeNames[t] || t).join(' / ');
        throw new ServiceError(
          `Không thể đổi gói sang '${servicePackage.name}' vì phòng hiện tại (${room.roomType}) không phù hợp. Vui lòng đổi phòng sang loại ${allowedStr} trước khi đổi gói.`,
          400
        );
      }
    }
  }
  const residentInvoices = residentId
    ? await invoiceRepo.findByResidentId(residentId, { sort: { issuedAt: -1 }, limit: 100 })
    : [];
  const contractInvoices = residentInvoices.filter((invoice) =>
    ['SERVICE', 'COMBINED'].includes(invoice.type)
    && Number(invoice.careServiceCost || 0) > 0
    && invoice.status !== 'CANCELLED'
  );

  const invoicesToCancel = contractInvoices.filter((invoice) => ['DRAFT', 'ISSUED'].includes(invoice.status));
  for (const invoice of invoicesToCancel) {
    await invoiceRepo.updateById(invoice._id, {
      status: 'CANCELLED',
      cancellationReason: 'Đã hủy do thay đổi gói dịch vụ.',
    });
  }

  const previousPackageMonthlyPrice = await resolveMonthlyPackagePrice(admission.servicePackageId);
  const newPackageMonthlyPrice = Number(servicePackage.monthlyPrice) || 0;
  const remainingMonths = getRemainingContractMonths(admission);
  const previousRemainingAmount = previousPackageMonthlyPrice * remainingMonths;
  const newRemainingAmount = newPackageMonthlyPrice * remainingMonths;
  const priceDelta = newRemainingAmount - previousRemainingAmount;

  const familyAccountId = admission.familyAccountId?._id || admission.familyAccountId || null;
  const adjustmentInvoice = priceDelta > 0
    ? await createChangePackageAdjustmentInvoice({
        residentId,
        familyAccountId,
        billingPeriodStart: new Date(),
        billingPeriodEnd: admission.contractEndDate ? new Date(admission.contractEndDate) : new Date(),
        careServiceCost: priceDelta,
        admin,
      })
    : null;

  if (priceDelta < 0) {
    const refundAmount = Math.abs(priceDelta);
    await walletService.refundToWallet(
      familyAccountId,
      refundAmount,
      'Hoàn tiền phần chênh lệch do đổi gói dịch vụ.',
      adjustmentInvoice?._id || null
    );
  }

  const previousPackage = admission.servicePackageId;
  const previousPackageName = admission.assignedServicePackage;
  const updated = await admissionRepo.updateAdmission(admissionId, {
    servicePackageId: servicePackage._id,
    assignedServicePackage: servicePackage.name,
  });

  if (admission.residentId) {
    await residentRepo.updateById(admission.residentId, { servicePackage: servicePackage.name });
  }

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'CHANGE_ADMISSION_CONTRACT_SERVICE_PACKAGE',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData: {
      requestCode: admission.requestCode,
      servicePackageId: previousPackage,
      assignedServicePackage: previousPackageName,
      previousPackageMonthlyPrice,
      newPackageMonthlyPrice,
      remainingMonths,
      priceDelta,
    },
    afterData: {
      requestCode: updated.requestCode,
      servicePackageId: servicePackage._id,
      assignedServicePackage: servicePackage.name,
      cancelledInvoiceIds: invoicesToCancel.map((invoice) => invoice._id),
      adjustmentInvoiceId: adjustmentInvoice?._id || null,
      priceDelta,
    },
    req,
  });

  return {
    message: 'Đổi gói dịch vụ thành công.',
    admission: formatAdmission(updated),
    adjustment: {
      action: priceDelta > 0 ? 'upgrade' : priceDelta < 0 ? 'downgrade' : 'no-change',
      priceDelta,
      remainingMonths,
      invoiceId: adjustmentInvoice?._id || null,
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
  const { contractStartDate, contractEndDate, servicePackageId, assignedBedId } = body;

  if (!contractEndDate) {
    throw { statusCode: 400, message: 'contractEndDate là bắt buộc' };
  }

  const newEndDate = new Date(contractEndDate);
  if (isNaN(newEndDate.getTime())) {
    throw { statusCode: 400, message: 'Định dạng contractEndDate không hợp lệ' };
  }

  // Validate contractStartDate if provided
  let newStartDate = null;
  if (contractStartDate) {
    newStartDate = new Date(contractStartDate);
    if (isNaN(newStartDate.getTime())) {
      throw { statusCode: 400, message: 'Định dạng contractStartDate không hợp lệ' };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (newStartDate < today) {
      throw { statusCode: 400, message: 'Ngày bắt đầu hợp đồng không được ở trong quá khứ' };
    }
  }

  const now = new Date();
  if (newEndDate <= now) {
    throw { statusCode: 400, message: 'Ngày kết thúc hợp đồng mới phải ở trong tương lai' };
  }

  const admission = await admissionRepo.findByIdForAdmin(admissionId);
  if (!admission) {
    throw { statusCode: 404, message: 'Không tìm thấy yêu cầu nhập viện' };
  }

  const oldEndDate = admission.contractEndDate;
  const oldServicePackageId = admission.servicePackageId;
  const updateData = {
    contractEndDate: newEndDate,
  };

  let selectedPackage = null;
  if (servicePackageId) {
    const pkg = await servicePackageRepo.findById(servicePackageId);
    if (!pkg) {
      throw { statusCode: 404, message: 'Không tìm thấy gói dịch vụ' };
    }
    if (!pkg.isActive) {
      throw { statusCode: 400, message: 'Gói dịch vụ hiện không hoạt động' };
    }
    selectedPackage = pkg;
    updateData.servicePackageId = pkg._id;
    updateData.assignedServicePackage = pkg.name;
  } else if (admission.servicePackageId) {
    selectedPackage = await servicePackageRepo.findById(admission.servicePackageId);
  }

  let targetBed = null;
  let targetRoomId = null;
  const residentId = admission.residentId?._id || admission.residentId || null;
  const resident = residentId ? await residentRepo.findById(residentId) : null;
  const currentBedId = admission.assignedBedId?._id || admission.assignedBedId || resident?.bedId || null;
  const currentRoomId = admission.assignedRoomId?._id || admission.assignedRoomId || resident?.roomId || null;
  const desiredBedId = assignedBedId || currentBedId;

  if (desiredBedId) {
    targetBed = await bedRepo.findById(desiredBedId);
    if (!targetBed) {
      throw { statusCode: 404, message: 'Không tìm thấy giường' };
    }

    const bedAssignedToResident = targetBed.assignedResidentId?.toString?.() || null;
    const isSameResidentBed = residentId && bedAssignedToResident && bedAssignedToResident === residentId.toString();
    if (targetBed.status !== 'available' && !isSameResidentBed) {
      throw { statusCode: 400, message: 'Giường hiện không khả dụng' };
    }

    targetRoomId = targetBed.roomId;
    if (selectedPackage) {
      const pkgTier = selectedPackage.tier || 'standard';
      const allowedTypes = selectedPackage.allowedRoomTypes?.length
        ? selectedPackage.allowedRoomTypes
        : (pkgTier === 'vip' ? ['icu', 'isolation'] : pkgTier === 'premium' ? ['premium'] : ['standard']);

      const room = await roomRepo.findById(targetRoomId);
      if (room && !allowedTypes.includes(room.roomType)) {
        const typeNames = { standard: 'Standard', premium: 'Premium', icu: 'ICU', isolation: 'Isolation' };
        const allowedStr = allowedTypes.map((t) => typeNames[t] || t).join(' / ');
        throw { statusCode: 400, message: `Không thể chọn phòng này cho gói '${selectedPackage.name}': chỉ được chọn loại ${allowedStr}.` };
      }
    }
    updateData.assignedBedId = targetBed._id;
    updateData.assignedRoomId = targetRoomId;
  } else if (currentRoomId) {
    updateData.assignedRoomId = currentRoomId;
  }

  if (newStartDate) {
    updateData.contractStartDate = newStartDate;
  }

  if (admission.contractStatus === 'cancelled') {
    updateData.contractStatus = 'active';
  }
  if (admission.status === 'new_request' || admission.status === 'pending') {
    updateData.status = 'contracting';
  }

  const updated = await admissionRepo.updateAdmission(admissionId, updateData);

  let residentWasCreated = false;
  let residentToReturn = resident;
  if (residentId) {
    residentToReturn = await residentRepo.findById(residentId);
    if (residentToReturn) {
      residentToReturn.residencyStatus = 'admitted';
      residentToReturn.admittedAt = residentToReturn.admittedAt || new Date();
      if (updateData.servicePackageId || admission.assignedServicePackage) {
        residentToReturn.servicePackage = updateData.assignedServicePackage || admission.assignedServicePackage || residentToReturn.servicePackage;
      }
      if (targetBed) {
        residentToReturn.bedId = targetBed._id;
      }
      if (targetRoomId) {
        residentToReturn.roomId = targetRoomId;
      }
      await residentToReturn.save();
    }
  }

  if (!residentToReturn) {
    const residentCode = await generateResidentCode();
    const applicant = admission.applicant || {};
    residentToReturn = await residentRepo.createResident({
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
      bedId: targetBed?._id || null,
      roomId: targetRoomId || null,
      residencyStatus: 'admitted',
      admittedAt: new Date(),
      servicePackage: updateData.assignedServicePackage || admission.assignedServicePackage || null,
      familyPortalAccountIds: admission.familyAccountId ? [admission.familyAccountId] : [],
      avatarUrl: applicant.avatarUrl,
      phone: applicant.phone,
    });
    residentWasCreated = true;
  }

  if (targetBed) {
    const oldAssignedBedId = resident?.bedId || admission.assignedBedId?._id || admission.assignedBedId || null;
    const oldAssignedRoomId = resident?.roomId || admission.assignedRoomId?._id || admission.assignedRoomId || null;

    if (oldAssignedBedId && oldAssignedBedId.toString() !== targetBed._id.toString()) {
      await bedRepo.releaseBed(oldAssignedBedId, new Date());
    }

    await bedRepo.occupyBed(targetBed._id, residentToReturn._id, new Date());

    if (oldAssignedRoomId && oldAssignedRoomId.toString() !== targetRoomId?.toString()) {
      await roomRepo.adjustOccupiedCount(oldAssignedRoomId, -1);
    }
    if (targetRoomId) {
      await roomRepo.adjustOccupiedCount(targetRoomId, 1);
    }
  }

  if (residentToReturn) {
    const admissionResidentId = admission.residentId?._id || admission.residentId || null;
    if (!admissionResidentId || admissionResidentId.toString() !== residentToReturn._id.toString()) {
      updateData.residentId = residentToReturn._id;
    }

    if ((!residentId && residentWasCreated) || (!admissionResidentId && residentToReturn)) {
      updateData.status = 'checked_in';
    }

    await admissionRepo.updateAdmission(admissionId, updateData);
  }

  const beforeData = {
    contractStartDate: admission.contractStartDate?.toISOString?.(),
    contractEndDate: oldEndDate?.toISOString?.(),
    servicePackageId: oldServicePackageId,
    status: admission.status,
    contractStatus: admission.contractStatus,
  };
  if (assignedBedId) {
    beforeData.assignedBedId = admission.assignedBedId;
  }

  const afterData = {
    contractStartDate: updated.contractStartDate?.toISOString?.(),
    contractEndDate: newEndDate.toISOString(),
    servicePackageId: updated.servicePackageId,
    contractStatus: updated.contractStatus,
    status: updated.status,
  };
  if (assignedBedId) {
    afterData.assignedBedId = updated.assignedBedId;
  }

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'EXTEND_CONTRACT',
    module: 'admission',
    targetEntityType: 'Admission',
    targetEntityId: admission._id,
    beforeData,
    afterData,
  });

  return {
    message: 'Đã gia hạn hợp đồng thành công',
    admission: formatAdmission(updated),
  };
};

module.exports = {
  submitAdmissionRequest,
  submitGuestAdmissionRequest,
  createWalkInAdmission,
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
  cancelAdmissionContract,
  changeContractServicePackage,
  checkInResident,
  extendAdmissionContract,
};


const { Types } = require('mongoose');
const { apiErr, apiSuccess, CODES, SUCCESS } = require('../utils/apiError');
const residentRepo = require('../repositories/residentRepository');
const roomRepo = require('../repositories/roomRepository');
const bedRepo = require('../repositories/bedRepository');
const floorRepo = require('../repositories/floorRepository');
const { GENDERS, BLOOD_TYPES, RESIDENCY_STATUSES } = require('../models/enums');
const { validateFullName, validatePhone } = require('../utils/validators');
const User = require('../models/user');
const Admission = require('../models/admission');
const { createAuditLog } = require('../utils/auditLog');
const { syncStaffAreasAfterResidentTransfer } = require('../utils/syncStaffAreasAfterResidentTransfer');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const startOfDay = (value, fieldName) => {
  const date = parseOptionalDate(value, fieldName);
  if (!date) return undefined;
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value, fieldName) => {
  const date = parseOptionalDate(value, fieldName);
  if (!date) return undefined;
  date.setHours(23, 59, 59, 999);
  return date;
};

const parseOptionalDate = (value, fieldName) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw apiErr(CODES.FIELD_INVALID_FORMAT, { statusCode: 400, params: { field: fieldName, format: 'valid date' } });
  }
  return date;
};

const normalizeStringArray = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return [String(value).trim()].filter(Boolean);
};

const contactPhoneKey = (contact) => String(contact?.phone || '').replace(/\D/g, '');

const contactEmailKey = (contact) => {
  const email = String(contact?.email || '').trim().toLowerCase();
  return email || null;
};

const throwDuplicateEmergencyContact = (candidate, existingContact) => {
  throw apiErr(CODES.RESIDENT_EMERGENCY_CONTACT_DUPLICATE, {
    statusCode: 409,
    params: { phone: candidate.phone, fullName: existingContact.fullName },
  });
};

const throwDuplicateEmergencyContactEmail = (candidate, existingContact) => {
  throw apiErr(CODES.RESIDENT_EMERGENCY_CONTACT_EMAIL_DUPLICATE, {
    statusCode: 409,
    params: { email: candidate.email, fullName: existingContact.fullName },
  });
};

const assertNoDuplicateEmergencyContact = (existingContacts, candidate, { excludeContactId } = {}) => {
  const phoneKey = contactPhoneKey(candidate);
  const phoneDup = (existingContacts || []).find((c) => {
    if (excludeContactId && c._id?.toString() === String(excludeContactId)) return false;
    return contactPhoneKey(c) === phoneKey;
  });
  if (phoneDup) throwDuplicateEmergencyContact(candidate, phoneDup);

  const emailKey = contactEmailKey(candidate);
  if (!emailKey) return;

  const emailDup = (existingContacts || []).find((c) => {
    if (excludeContactId && c._id?.toString() === String(excludeContactId)) return false;
    return contactEmailKey(c) === emailKey;
  });
  if (emailDup) throwDuplicateEmergencyContactEmail(candidate, emailDup);
};

const assertEmergencyContactsListUnique = (contacts) => {
  const seenPhones = new Map();
  const seenEmails = new Map();
  for (const c of contacts || []) {
    const phoneKey = contactPhoneKey(c);
    if (seenPhones.has(phoneKey)) throwDuplicateEmergencyContact(c, seenPhones.get(phoneKey));
    seenPhones.set(phoneKey, c);

    const emailKey = contactEmailKey(c);
    if (!emailKey) continue;
    if (seenEmails.has(emailKey)) throwDuplicateEmergencyContactEmail(c, seenEmails.get(emailKey));
    seenEmails.set(emailKey, c);
  }
};

const normalizeEmergencyContacts = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) throw apiErr(CODES.RESIDENT_VALIDATION_FAILED, { statusCode: 400, params: { detail: 'emergencyContacts phải là mảng' } });
  const normalized = value.map((contact, index) => {
    if (!contact || typeof contact !== 'object') {
      throw apiErr(CODES.RESIDENT_VALIDATION_FAILED, { statusCode: 400, params: { detail: `emergencyContacts[${index}] phải là object` } });
    }
    const fullName = String(contact.fullName || '').trim();
    const relationship = String(contact.relationship || '').trim();
    const phone = String(contact.phone || '').trim();
    if (!fullName || !relationship || !phone) {
      throw apiErr(CODES.RESIDENT_VALIDATION_FAILED, { statusCode: 400, params: { detail: `emergencyContacts[${index}] phải có đầy đủ fullName, relationship và phone` } });
    }
    const phoneErr = validatePhone(phone);
    if (phoneErr) {
      throw apiErr(CODES.RESIDENT_VALIDATION_FAILED, { statusCode: 400, params: { detail: `emergencyContacts[${index}]: ${phoneErr}` } });
    }
    return {
      fullName,
      relationship,
      phone,
      email: contact.email ? String(contact.email).trim().toLowerCase() : undefined,
      address: contact.address ? String(contact.address).trim() : undefined,
      isPrimary: Boolean(contact.isPrimary),
    };
  });
  assertEmergencyContactsListUnique(normalized);
  return normalized;
};

const normalizeFamilyAccountIds = async (value) => {
  if (value === undefined) return undefined;
  if (value === null) return [];
  const rawIds = Array.isArray(value) ? value : [value];
  const ids = rawIds.map((id) => String(id).trim()).filter(Boolean);
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];
  const invalidIds = uniqueIds.filter((id) => !Types.ObjectId.isValid(id));
  if (invalidIds.length) throw apiErr(CODES.RESIDENT_VALIDATION_FAILED, { statusCode: 400, params: { detail: `familyPortalAccountIds không hợp lệ: ${invalidIds.join(', ')}` } });
  const users = await User.find({ _id: { $in: uniqueIds }, role: 'family' }).select('_id');
  if (users.length !== uniqueIds.length) {
    throw apiErr(CODES.RESIDENT_VALIDATION_FAILED, { statusCode: 400, params: { detail: 'Một số familyPortalAccountIds không tồn tại hoặc không phải tài khoản family' } });
  }
  return uniqueIds;
};

const generateResidentCode = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `RES${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const exists = await residentRepo.findByResidentCode(code);
    if (!exists) return code;
  }
  throw apiErr(CODES.INTERNAL_ERROR, { statusCode: 500 });
};

const calcAge = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age;
};

const mapAreaFromRoom = (room) => {
  if (!room) return { room: null, floor: null, building: null };
  const floor = room.floorId;
  const building = floor?.buildingId || room.buildingId;
  const roomNumber = room.roomNumber || room.roomCode;
  const floorName = floor?.name || (floor?.floorNumber != null ? `Tang ${floor.floorNumber}` : null);
  const buildingName = building?.name || building?.code;
  return {
    room: {
      _id: room._id,
      roomNumber,
      roomType: room.roomType,
      label: roomNumber ? `Phong ${roomNumber}` : null,
    },
    floor: floor
      ? {
          _id: floor._id,
          name: floor.name,
          floorNumber: floor.floorNumber,
          label: buildingName && floorName ? `${floorName} - ${buildingName}` : floorName,
        }
      : null,
    building: building ? { _id: building._id, code: building.code, name: building.name } : null,
  };
};

const hasDrugAllergiesRecord = (resident) => (resident?.drugAllergies || []).length > 0;

const formatResident = (residentDoc) => {
  const resident = residentDoc?.toObject ? residentDoc.toObject() : residentDoc;
  if (!resident) return null;
  const area = mapAreaFromRoom(resident.roomId);
  return {
    _id: resident._id,
    residentCode: resident.residentCode,
    fullName: resident.fullName,
    dateOfBirth: resident.dateOfBirth,
    age: calcAge(resident.dateOfBirth),
    gender: resident.gender,
    citizenId: resident.citizenId,
    insuranceNumber: resident.insuranceNumber,
    bloodType: resident.bloodType,
    personalAddress: resident.personalAddress,
    avatarUrl: resident.avatarUrl || undefined,
    emergencyContacts: resident.emergencyContacts || [],
    allergies: resident.allergies || [],
    drugAllergies: resident.drugAllergies || [],
    hasDrugAllergiesRecord: hasDrugAllergiesRecord(resident),
    drugAllergiesCount: (resident.drugAllergies || []).length,
    chronicConditions: resident.chronicConditions || [],
    medicalHistory: resident.medicalHistory || [],
    initialHealthCondition: resident.initialHealthCondition,
    residencyStatus: resident.residencyStatus,
    admittedAt: resident.admittedAt,
    dischargedAt: resident.dischargedAt,
    servicePackage: resident.servicePackage,
    emergencyContactCount: resident.emergencyContacts?.length ?? 0,
    area: {
      room: area.room,
      floor: area.floor,
      building: area.building,
      bed: resident.bedId
        ? {
            _id: resident.bedId._id || resident.bedId,
            bedCode: resident.bedId.bedCode,
            status: resident.bedId.status,
            bedType: resident.bedId.bedType,
          }
        : null,
    },
    room: resident.roomId
      ? { _id: resident.roomId._id || resident.roomId, roomCode: resident.roomId.roomCode, name: resident.roomId.name }
      : null,
    bed: resident.bedId ? { _id: resident.bedId._id || resident.bedId, bedCode: resident.bedId.bedCode } : null,
    familyPortalAccounts: Array.isArray(resident.familyPortalAccountIds)
      ? resident.familyPortalAccountIds.map((user) => ({
          _id: user._id || user,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
        }))
      : [],
    createdAt: resident.createdAt,
    updatedAt: resident.updatedAt,
  };
};

const assertResidentId = (residentId) => {
  if (!residentRepo.assertValidObjectId(residentId)) throw apiErr(CODES.RESIDENT_INVALID_ID, { statusCode: 400 });
};

/** Resolve MongoDB resident _id from ObjectId string or residentCode (e.g. RES001). */
const resolveResidentId = async (residentIdOrCode) => {
  const raw = String(residentIdOrCode || '').trim();
  if (!raw) throw apiErr(CODES.RESIDENT_ID_REQUIRED, { statusCode: 400 });

  if (residentRepo.assertValidObjectId(raw)) {
    const byId = await residentRepo.findById(raw);
    if (byId) return byId._id;
  }

  const byCode = await residentRepo.findByResidentCode(raw);
  if (byCode) return byCode._id;

  throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
};

const RESIDENCY_STATUS_ALIASES = {
  treating: 'admitted',
  under_treatment: 'admitted',
  in_treatment: 'admitted',
  active: 'admitted',
  'dang dieu tri': 'admitted',
};

const normalizeResidencyStatusFilter = (status) => {
  if (status === undefined || status === null || status === '') return 'admitted';
  const s = String(status).trim();
  if (!s || s.toLowerCase() === 'all') return undefined;
  const key = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
  if (RESIDENCY_STATUS_ALIASES[key]) return RESIDENCY_STATUS_ALIASES[key];
  if (RESIDENCY_STATUSES.includes(s)) return s;
  return s;
};

const parseInitialHealthConditionFromBody = (body) => {
  if (!body || typeof body !== 'object') return null;
  const direct = body.initialHealthCondition ?? body.description ?? body.healthCondition;
  if (direct !== undefined && direct !== null) return String(direct).trim();
  if (body.initialHealth && typeof body.initialHealth === 'object') {
    const nested =
      body.initialHealth.initialHealthCondition ??
      body.initialHealth.description ??
      body.initialHealth.healthCondition;
    if (nested !== undefined && nested !== null) return String(nested).trim();
  }
  return null;
};

const parseBloodTypeFromBody = (body) => {
  if (!body) return undefined;
  let value = body.bloodType;
  if ((value === undefined || value === null) && body.initialHealth?.bloodType !== undefined) {
    value = body.initialHealth.bloodType;
  }
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
};

const assertContactId = (contactId) => {
  if (!residentRepo.assertValidObjectId(contactId)) throw apiErr(CODES.RESIDENT_ID_INVALID, { statusCode: 400, params: { label: 'contactId' } });
};

const assertObjectId = (value, label) => {
  if (!residentRepo.assertValidObjectId(value)) throw apiErr(CODES.RESIDENT_ID_INVALID, { statusCode: 400, params: { label } });
};

const validateOptionalEmail = (email) => {
  if (email === undefined || email === null || String(email).trim() === '') return null;
  if (!EMAIL_REGEX.test(String(email).trim())) return 'email is invalid';
  return null;
};

const normalizeContactInput = (body, { partial = false } = {}) => {
  const out = {};
  if (!partial || body.fullName !== undefined) out.fullName = body.fullName?.trim();
  if (!partial || body.relationship !== undefined) out.relationship = body.relationship?.trim();
  if (!partial || body.phone !== undefined) out.phone = body.phone?.trim();
  if (!partial || body.email !== undefined) out.email = body.email?.trim() ? body.email.trim().toLowerCase() : undefined;
  if (!partial || body.address !== undefined) out.address = body.address?.trim() || undefined;
  if (!partial || body.isPrimary !== undefined) out.isPrimary = Boolean(body.isPrimary);
  return out;
};

const validateContactPayload = (contact, { requireAll = true, partial = false } = {}) => {
  const errors = [];
  if (requireAll || contact.fullName !== undefined) {
    const err = validateFullName(contact.fullName);
    if (err) errors.push(err);
  }
  if (requireAll || contact.relationship !== undefined) {
    if (!contact.relationship) errors.push('relationship là bắt buộc');
  }
  if (requireAll || contact.phone !== undefined) {
    if (!contact.phone) errors.push('phone là bắt buộc');
    else {
      const phoneErr = validatePhone(contact.phone);
      if (phoneErr) errors.push(phoneErr);
    }
  }
  if (contact.email !== undefined) {
    const emailErr = validateOptionalEmail(contact.email);
    if (emailErr) errors.push(emailErr);
  }
  if (errors.length) throw apiErr(CODES.RESIDENT_VALIDATION_FAILED, { statusCode: 400, params: { detail: errors.join('; ') } });
  return normalizeContactInput(contact, { partial });
};

const ensureSinglePrimary = (contacts) => {
  const primaryCount = contacts.filter((c) => c.isPrimary).length;
  if (primaryCount > 1) throw apiErr(CODES.RESIDENT_EMERGENCY_CONTACT_PRIMARY_LIMIT, { statusCode: 400 });
};

const matchEmergencyContact = (a, b) => {
  const aId = a?._id?.toString?.();
  const bId = b?._id?.toString?.();
  if (aId && bId && aId === bId) return true;
  return contactPhoneKey(a) === contactPhoneKey(b);
};

const assertPrimaryContactNotRemoved = (existingContacts, nextContacts) => {
  const primaryBefore = (existingContacts || []).find((c) => c.isPrimary);
  if (!primaryBefore) return;

  const stillPresent = (nextContacts || []).some((c) => matchEmergencyContact(c, primaryBefore));
  if (stillPresent) return;

  const hasNewPrimary = (nextContacts || []).some((c) => c.isPrimary);
  if (!hasNewPrimary) throw apiErr(CODES.RESIDENT_EMERGENCY_CONTACT_CANNOT_DELETE_PRIMARY, { statusCode: 400 });
};

const mapResidentFamilySummary = (resident) => ({
  _id: resident._id,
  residentCode: resident.residentCode,
  fullName: resident.fullName,
  roomId: resident.roomId,
  residencyStatus: resident.residencyStatus,
  emergencyContactCount: resident.emergencyContacts?.length ?? 0,
});

const parseAssignmentStatusFilter = (status) => {
  if (!status || String(status).toLowerCase() === 'all') {
    return undefined;
  }

  let queryStatus = status;
  if (String(status).includes(',')) {
    const statuses = String(status)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    statuses.forEach((s) => {
      if (!RESIDENCY_STATUSES.includes(s)) {
        throw apiErr(CODES.RESIDENT_STATUS_INVALID, { statusCode: 400, params: { allowed: RESIDENCY_STATUSES.join(', ') } });
      }
    });
    queryStatus = statuses;
  } else if (!RESIDENCY_STATUSES.includes(String(status))) {
    throw apiErr(CODES.RESIDENT_STATUS_INVALID, { statusCode: 400, params: { allowed: RESIDENCY_STATUSES.join(', ') } });
  }

  return queryStatus;
};

const listResidentsForAssignment = async ({ floorId, roomId, search, status }, user) => {
  const queryStatus = parseAssignmentStatusFilter(status);

  let residentIds = null;
  if (user && ['doctor', 'nurse', 'caregiver'].includes(user.role)) {
    const staffProfileRepo = require('../repositories/staffProfileRepository');
    const profile = await staffProfileRepo.findByUserId(user._id);
    if (!profile) throw apiErr(CODES.STAFF_PROFILE_NOT_FOUND, { statusCode: 404 });

    const idsSet = new Set((profile.assignedResidentIds || []).map((id) => id.toString()));

    try {
      const CareAppointment = require('../models/careAppointment');
      const roleField = user.role === 'doctor' ? 'doctorStaffId' : 'nurseStaffId';
      const activeAppts = await CareAppointment.find({
        [roleField]: profile._id,
        appointmentType: 'Khám lâm sàng đầu vào',
      }).select('residentId');

      activeAppts.forEach((appt) => {
        if (appt.residentId) {
          idsSet.add(appt.residentId.toString());
        }
      });
    } catch (err) {
      console.error('Failed to dynamically aggregate intake appointment resident IDs:', err);
    }

    residentIds = Array.from(idsSet);
  }

  const data = await residentRepo.findForAssignment({ floorId, roomId, search, status: queryStatus, residentIds });
  const formatted = data.map((row) => formatResident(row)).filter(Boolean);
  return { data: formatted, total: formatted.length };
};

const listResidentsForFamilyManagement = async ({ search, status, page = 1, limit = 20 }) => {
  const queryStatus = String(status || '').toLowerCase() === 'all' ? undefined : status;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10) || 20));
  const { data, total, page: currentPage, limit: currentLimit } = await residentRepo.findForFamilyManagement({
    search,
    status: queryStatus,
    page: pageNum,
    limit: limitNum,
  });
  return {
    data: data.map(mapResidentFamilySummary),
    total,
    page: currentPage,
    limit: currentLimit,
    totalPages: Math.ceil(total / currentLimit),
  };
};

const getResidentFamilyInfo = async (residentId) => {
  assertResidentId(residentId);
  const resident = await residentRepo.findByIdWithFamily(residentId);
  if (!resident) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  return {
    resident: {
      _id: resident._id,
      residentCode: resident.residentCode,
      fullName: resident.fullName,
      dateOfBirth: resident.dateOfBirth,
      gender: resident.gender,
      residencyStatus: resident.residencyStatus,
      roomId: resident.roomId,
    },
    emergencyContacts: resident.emergencyContacts || [],
  };
};

const addEmergencyContact = async (residentId, body) => {
  assertResidentId(residentId);
  const contact = validateContactPayload(body, { requireAll: true });
  const existing = await residentRepo.findById(residentId);
  if (!existing) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  assertNoDuplicateEmergencyContact(existing.emergencyContacts, contact);
  const resident = await residentRepo.addEmergencyContact(residentId, contact);
  if (!resident) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  const added = resident.emergencyContacts[resident.emergencyContacts.length - 1];
  return { ...apiSuccess(SUCCESS.RESIDENT_EMERGENCY_CONTACT_ADDED), emergencyContact: added, emergencyContacts: resident.emergencyContacts };
};

const replaceEmergencyContacts = async (residentId, contactsInput) => {
  assertResidentId(residentId);
  if (!Array.isArray(contactsInput)) throw apiErr(CODES.RESIDENT_VALIDATION_FAILED, { statusCode: 400, params: { detail: 'contacts phải là mảng' } });
  const contacts = contactsInput.map((c) => validateContactPayload(c, { requireAll: true }));
  ensureSinglePrimary(contacts);
  let primarySet = false;
  const normalized = contacts.map((c) => {
    if (c.isPrimary && !primarySet) {
      primarySet = true;
      return c;
    }
    return { ...c, isPrimary: false };
  });
  if (!primarySet && normalized.length > 0) {
    normalized[0].isPrimary = true;
  }
  assertEmergencyContactsListUnique(normalized);
  const existing = await residentRepo.findById(residentId);
  if (!existing) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  assertPrimaryContactNotRemoved(existing.emergencyContacts, normalized);
  const resident = await residentRepo.replaceEmergencyContacts(residentId, normalized);
  if (!resident) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  return { ...apiSuccess(SUCCESS.RESIDENT_EMERGENCY_CONTACT_UPDATED), emergencyContacts: resident.emergencyContacts };
};

const updateEmergencyContact = async (residentId, contactId, body) => {
  assertResidentId(residentId);
  assertContactId(contactId);
  const patch = validateContactPayload(body, { requireAll: false, partial: true });
  const existing = await residentRepo.findById(residentId);
  if (!existing) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  const current = existing.emergencyContacts?.id?.(contactId);
  if (!current) throw apiErr(CODES.RESIDENT_CONTACT_NOT_FOUND, { statusCode: 404 });
  const merged = {
    fullName: patch.fullName !== undefined ? patch.fullName : current.fullName,
    phone: patch.phone !== undefined ? patch.phone : current.phone,
    relationship: patch.relationship !== undefined ? patch.relationship : current.relationship,
    email: patch.email !== undefined ? patch.email : current.email,
    address: patch.address !== undefined ? patch.address : current.address,
    isPrimary: patch.isPrimary !== undefined ? patch.isPrimary : current.isPrimary,
  };
  assertNoDuplicateEmergencyContact(existing.emergencyContacts, merged, { excludeContactId: contactId });
  const resident = await residentRepo.updateEmergencyContact(residentId, contactId, patch);
  if (!resident) throw apiErr(CODES.RESIDENT_CONTACT_NOT_FOUND, { statusCode: 404 });
  const updated = resident.emergencyContacts.id(contactId);
  return { ...apiSuccess(SUCCESS.RESIDENT_EMERGENCY_CONTACT_UPDATED), emergencyContact: updated, emergencyContacts: resident.emergencyContacts };
};

const removeEmergencyContact = async (residentId, contactId) => {
  assertResidentId(residentId);
  assertContactId(contactId);
  const existing = await residentRepo.findById(residentId);
  if (!existing) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  const contact = existing.emergencyContacts?.id?.(contactId);
  if (!contact) throw apiErr(CODES.RESIDENT_CONTACT_NOT_FOUND, { statusCode: 404 });
  if (contact.isPrimary) throw apiErr(CODES.RESIDENT_EMERGENCY_CONTACT_CANNOT_DELETE_PRIMARY, { statusCode: 400 });
  const resident = await residentRepo.removeEmergencyContact(residentId, contactId);
  return { ...apiSuccess(SUCCESS.RESIDENT_EMERGENCY_CONTACT_DELETED), emergencyContacts: resident.emergencyContacts };
};

const assertAreaFilter = ({ buildingId, floorId, roomId }) => {
  if (!buildingId && !floorId && !roomId) throw apiErr(CODES.RESIDENT_LOCATION_ID_REQUIRED, { statusCode: 400 });
  if (buildingId && !residentRepo.assertValidObjectId(buildingId)) throw apiErr(CODES.RESIDENT_LOCATION_ID_INVALID, { statusCode: 400, params: { label: 'buildingId' } });
  if (floorId && !residentRepo.assertValidObjectId(floorId)) throw apiErr(CODES.RESIDENT_LOCATION_ID_INVALID, { statusCode: 400, params: { label: 'floorId' } });
  if (roomId && !residentRepo.assertValidObjectId(roomId)) throw apiErr(CODES.RESIDENT_LOCATION_ID_INVALID, { statusCode: 400, params: { label: 'roomId' } });
};

const mapResolveError = (error) => {
  const codeMap = {
    room_not_found: CODES.RESIDENT_VALIDATION_FAILED,
    floor_not_found: CODES.RESIDENT_VALIDATION_FAILED,
    room_floor_mismatch: CODES.RESIDENT_VALIDATION_FAILED,
    room_building_mismatch: CODES.RESIDENT_VALIDATION_FAILED,
    floor_building_mismatch: CODES.RESIDENT_VALIDATION_FAILED,
  };
  const messages = {
    room_not_found: 'Không tìm thấy phòng',
    floor_not_found: 'Không tìm thấy tầng',
    room_floor_mismatch: 'roomId does not belong to the specified floorId',
    room_building_mismatch: 'roomId does not belong to the specified buildingId',
    floor_building_mismatch: 'floorId does not belong to the specified buildingId',
  };
  if (error && messages[error]) {
    throw apiErr(codeMap[error], { statusCode: 400, params: { detail: messages[error] } });
  }
};

const getResidentsAreaSummary = async ({ buildingId, status }) => {
  if (buildingId && !residentRepo.assertValidObjectId(buildingId)) throw apiErr(CODES.RESIDENT_LOCATION_ID_INVALID, { statusCode: 400, params: { label: 'buildingId' } });
  if (status && !RESIDENCY_STATUSES.includes(status)) {
    throw apiErr(CODES.RESIDENT_STATUS_INVALID, { statusCode: 400, params: { allowed: RESIDENCY_STATUSES.join(', ') } });
  }
  return residentRepo.getAreaSummary({ buildingId, status: status || 'admitted' });
};

const listResidentsByArea = async ({ buildingId, floorId, roomId, search, status, page = 1, limit = 20 }) => {
  assertAreaFilter({ buildingId, floorId, roomId });
  const normalizedStatus = normalizeResidencyStatusFilter(status);
  if (normalizedStatus && !RESIDENCY_STATUSES.includes(normalizedStatus)) {
    throw apiErr(CODES.RESIDENT_STATUS_INVALID, { statusCode: 400, params: { allowed: RESIDENCY_STATUSES.join(', ') } });
  }
  const result = await residentRepo.findByArea({
    buildingId,
    floorId,
    roomId,
    search,
    status: normalizedStatus,
    page: Math.max(1, parseInt(page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 20)),
  });
  mapResolveError(result.error);
  return {
    data: result.data.map((r) => formatResident(r)),
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: Math.ceil(result.total / result.limit) || 0,
  };
};

const getResidentDetail = async (residentIdOrCode) => {
  const residentId = await resolveResidentId(residentIdOrCode);
  const resident = await residentRepo.findByIdWithDetail(residentId);
  if (!resident) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  return { resident: formatResident(resident) };
};

const mapTransferAssignment = (resident) => {
  const area = mapAreaFromRoom(resident.roomId);
  return {
    room: area.room,
    floor: area.floor,
    building: area.building,
    bed: resident.bedId
      ? {
          _id: resident.bedId._id,
          roomId: resident.bedId.roomId,
          bedCode: resident.bedId.bedCode,
          bedType: resident.bedId.bedType,
          status: resident.bedId.status,
        }
      : null,
  };
};

const getTransferTargets = async (residentId, { floorId }) => {
  assertResidentId(residentId);
  assertObjectId(floorId, 'floorId');
  const resident = await residentRepo.findByIdForTransfer(residentId);
  if (!resident) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });

  const floor = await floorRepo.findById(floorId);
  if (!floor) throw apiErr(CODES.RESIDENT_TRANSFER_FLOOR_NOT_FOUND, { statusCode: 404 });

  const currentAssignment = mapTransferAssignment(resident);
  const hasCurrentAssignment = Boolean(resident?.roomId || resident?.bedId);
  const rooms = await roomRepo.findByFloorId(floorId);
  const roomIds = rooms.map((room) => room._id);
  const admittedCountByRoomId = await residentRepo.countAdmittedByRoomIds(roomIds);
  const availableBeds = await bedRepo.findAvailableByRoomIds(roomIds);
  const bedsByRoomId = new Map();
  for (const bed of availableBeds) {
    const key = String(bed.roomId);
    if (!bedsByRoomId.has(key)) bedsByRoomId.set(key, []);
    bedsByRoomId.get(key).push({ _id: bed._id, bedCode: bed.bedCode, bedType: bed.bedType, status: bed.status });
  }

  const currentBedId = resident?.bedId ? String(resident.bedId?._id || resident.bedId) : '';
  const currentRoomId = resident?.roomId ? String(resident.roomId?._id || resident.roomId) : '';
  const targets = rooms
    .map((room) => ({
      _id: room._id,
      roomNumber: room.roomNumber,
      roomType: room.roomType,
      capacity: room.capacity,
      occupiedCount: room.occupiedCount,
      status: room.status,
      availableBeds: (bedsByRoomId.get(String(room._id)) || []).filter(
        (bed) => !currentBedId || String(bed._id) !== currentBedId
      ),
    }))
    .filter((room) => {
      if (room.availableBeds.length === 0) return false;
      if (room.status === 'closed') return false;
      if (currentRoomId && String(room._id) === currentRoomId) return true;
      const admittedCount = admittedCountByRoomId.get(String(room._id)) || 0;
      return admittedCount < room.capacity;
    });

  const noTargets = targets.length === 0;
  const infoMessage = noTargets ? apiSuccess(SUCCESS.RESIDENT_TRANSFER_NO_TARGETS) : null;

  return {
    resident: {
      _id: resident._id,
      residentCode: resident.residentCode,
      fullName: resident.fullName,
      residencyStatus: resident.residencyStatus,
    },
    currentAssignment: hasCurrentAssignment ? currentAssignment : null,
    targets,
    ...(infoMessage || {}),
  };
};

const transferResidentToRoom = async (residentId, { targetRoomId, targetBedId }) => {
  assertResidentId(residentId);
  assertObjectId(targetRoomId, 'targetRoomId');
  assertObjectId(targetBedId, 'targetBedId');
  const resident = await residentRepo.findByIdForTransfer(residentId);
  if (!resident) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  if (resident.residencyStatus !== 'admitted') throw apiErr(CODES.RESIDENT_TRANSFER_NOT_ADMITTED, { statusCode: 400 });

  const hasCurrentAssignment = Boolean(resident.roomId || resident.bedId);
  const currentBedId = resident.bedId ? String(resident.bedId._id || resident.bedId) : null;
  if (currentBedId && currentBedId === String(targetBedId)) throw apiErr(CODES.RESIDENT_TRANSFER_SAME_BED, { statusCode: 400 });

  const targetRoom = await roomRepo.findById(targetRoomId);
  if (!targetRoom) throw apiErr(CODES.RESIDENT_TRANSFER_ROOM_NOT_FOUND, { statusCode: 404 });
  if (targetRoom.status === 'closed') throw apiErr(CODES.RESIDENT_TRANSFER_ROOM_CLOSED, { statusCode: 400 });

  const sourceRoomId = resident.roomId ? String(resident.roomId._id || resident.roomId) : null;
  const sameRoom = sourceRoomId && sourceRoomId === String(targetRoomId);
  if (!sameRoom) {
    const admittedInTarget = await residentRepo.countAdmittedInRoom(targetRoomId);
    if (admittedInTarget >= targetRoom.capacity) {
      throw apiErr(CODES.RESIDENT_TRANSFER_ROOM_FULL, { statusCode: 400 });
    }
  }

  const targetBed = await bedRepo.findById(targetBedId);
  if (!targetBed) throw apiErr(CODES.RESIDENT_TRANSFER_BED_NOT_FOUND, { statusCode: 404 });
  if (String(targetBed.roomId) !== String(targetRoomId)) throw apiErr(CODES.RESIDENT_TRANSFER_BED_MISMATCH, { statusCode: 400 });
  if (targetBed.status !== 'available' || targetBed.assignedResidentId) throw apiErr(CODES.RESIDENT_TRANSFER_BED_UNAVAILABLE, { statusCode: 400 });

  if (resident.bedId) {
    await bedRepo.releaseBed(resident.bedId._id, new Date());
  }
  if (!sameRoom && resident.roomId) {
    await roomRepo.adjustOccupiedCount(resident.roomId._id, -1);
  }
  await bedRepo.occupyBed(targetBedId, resident._id, new Date());
  if (!sameRoom) {
    await roomRepo.adjustOccupiedCount(targetRoomId, 1);
  }

  const updatedResident = await residentRepo.updateRoomAssignment(residentId, { roomId: targetRoomId, bedId: targetBedId });
  if (!updatedResident) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });

  if (resident.roomId) {
    await roomRepo.syncRoomOccupancy(resident.roomId._id);
  }
  await roomRepo.syncRoomOccupancy(targetRoomId);

  const targetFloorId = targetRoom.floorId?._id || targetRoom.floorId;
  const staffAreasSynced = await syncStaffAreasAfterResidentTransfer(residentId, {
    targetRoomId,
    targetFloorId,
  });

  return {
    ...apiSuccess(SUCCESS.RESIDENT_TRANSFERRED),
    resident: {
      _id: updatedResident._id,
      residentCode: updatedResident.residentCode,
      fullName: updatedResident.fullName,
      residencyStatus: updatedResident.residencyStatus,
      roomId: updatedResident.roomId?._id || updatedResident.roomId,
      bedId: updatedResident.bedId?._id || updatedResident.bedId,
    },
    from: mapTransferAssignment(resident),
    to: mapTransferAssignment(updatedResident),
    staffAreasSynced,
  };
};

const adminReleaseResident = async (admin, residentId, req) => {
  assertResidentId(residentId);
  const resident = await residentRepo.findByIdForTransfer(residentId);
  if (!resident) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });

  const currentRoomId = resident.roomId?._id || resident.roomId;
  const currentBedId = resident.bedId?._id || resident.bedId;

  if (currentBedId) {
    await bedRepo.releaseBed(currentBedId, new Date());
  }
  if (currentRoomId) {
    await roomRepo.adjustOccupiedCount(currentRoomId, -1);
  }

  const updatedResident = await residentRepo.updateById(residentId, {
    roomId: null,
    bedId: null,
    servicePackage: null,
    residencyStatus: 'pending',
  });

  const linkedAdmission = await Admission.findOne({ residentId }).sort({ createdAt: -1 });
  if (linkedAdmission) {
    await Admission.findByIdAndUpdate(
      linkedAdmission._id,
      {
        servicePackageId: null,
        assignedServicePackage: null,
      },
      { new: true, runValidators: true }
    );
  }

  if (currentRoomId) {
    await roomRepo.syncRoomOccupancy(currentRoomId);
  }

  await createAuditLog({
    actorUserId: admin._id,
    actorRole: admin.role,
    action: 'RELEASE_RESIDENT_ROOM_BED',
    displayAction: 'Giải phóng phòng/giường cư dân',
    businessModule: 'resident',
    module: 'resident',
    targetEntityType: 'Resident',
    targetEntityId: residentId,
    beforeData: {
      roomId: resident.roomId,
      bedId: resident.bedId,
      servicePackage: resident.servicePackage,
      residencyStatus: resident.residencyStatus,
    },
    afterData: {
      roomId: null,
      bedId: null,
      servicePackage: null,
      residencyStatus: 'pending',
    },
    req,
  });

  return {
    ...apiSuccess(SUCCESS.RESIDENT_UPDATED, { message: 'Giải phóng phòng/giường cư dân thành công.' }),
    resident: formatResident(updatedResident),
  };
};

const hasInitialHealthRecord = (resident) => Boolean(resident?.initialHealthCondition && String(resident.initialHealthCondition).trim());
const mapInitialHealth = (resident) => ({
  bloodType: resident.bloodType,
  initialHealthCondition: resident.initialHealthCondition || '',
  hasInitialHealthRecord: hasInitialHealthRecord(resident),
  updatedAt: resident.updatedAt,
});

const formatResidentForInitialHealthList = (residentDoc) => {
  const base = formatResident(residentDoc);
  if (!base) return null;
  return {
    ...base,
    hasInitialHealthRecord: hasInitialHealthRecord(residentDoc),
  };
};

const listResidentsForInitialHealth = async ({ search, status, recorded, page = 1, limit = 20 }) => {
  const normalizedStatus = normalizeResidencyStatusFilter(status);
  const { data, total, page: currentPage, limit: currentLimit } = await residentRepo.findForInitialHealthList({
    search,
    status: normalizedStatus,
    recorded,
    page: Math.max(1, parseInt(page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 20)),
  });
  return {
    data: data.map((r) => formatResidentForInitialHealthList(r)),
    total,
    page: currentPage,
    limit: currentLimit,
    totalPages: Math.ceil(total / currentLimit) || 0,
  };
};

const hasPreExistingRecord = (resident) => {
  const chronic = resident?.chronicConditions || [];
  const history = resident?.medicalHistory || [];
  return chronic.length > 0 || history.length > 0;
};

const mapPreExistingConditions = (resident) => ({
  chronicConditions: resident?.chronicConditions || [],
  medicalHistory: resident?.medicalHistory || [],
  hasPreExistingRecord: hasPreExistingRecord(resident),
  chronicConditionsCount: (resident?.chronicConditions || []).length,
  medicalHistoryCount: (resident?.medicalHistory || []).length,
  updatedAt: resident?.updatedAt,
});

const parsePreExistingBody = (body) => {
  if (!body || typeof body !== 'object') {
    return { chronicConditions: undefined, medicalHistory: undefined };
  }
  const nested =
    body.preExistingConditions && typeof body.preExistingConditions === 'object'
      ? body.preExistingConditions
      : null;
  const source = nested || body;
  return {
    chronicConditions:
      source.chronicConditions !== undefined
        ? normalizeStringArray(source.chronicConditions)
        : undefined,
    medicalHistory:
      source.medicalHistory !== undefined
        ? normalizeStringArray(source.medicalHistory)
        : undefined,
  };
};

const formatResidentForPreExistingList = (residentDoc) => {
  const base = formatResident(residentDoc);
  if (!base) return null;
  const chronic = residentDoc?.chronicConditions || [];
  const history = residentDoc?.medicalHistory || [];
  return {
    ...base,
    hasPreExistingRecord: hasPreExistingRecord(residentDoc),
    chronicConditionsCount: chronic.length,
    medicalHistoryCount: history.length,
  };
};

const listResidentsForPreExisting = async ({ search, status, recorded, page = 1, limit = 20 }) => {
  const normalizedStatus = normalizeResidencyStatusFilter(status);
  const { data, total, page: currentPage, limit: currentLimit } = await residentRepo.findForPreExistingList({
    search,
    status: normalizedStatus,
    recorded,
    page: Math.max(1, parseInt(page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 20)),
  });
  return {
    data: data.map((r) => formatResidentForPreExistingList(r)),
    total,
    page: currentPage,
    limit: currentLimit,
    totalPages: Math.ceil(total / currentLimit) || 0,
  };
};

const mapDrugAllergies = (resident) => ({
  drugAllergies: resident?.drugAllergies || [],
  hasDrugAllergiesRecord: hasDrugAllergiesRecord(resident),
  drugAllergiesCount: (resident?.drugAllergies || []).length,
  updatedAt: resident?.updatedAt,
});

const parseDrugAllergiesBody = (body) => {
  if (!body || typeof body !== 'object') return undefined;

  if (Array.isArray(body.drugAllergies)) {
    return normalizeStringArray(body.drugAllergies);
  }

  if (body.drugAllergies && typeof body.drugAllergies === 'object' && !Array.isArray(body.drugAllergies)) {
    const nested = body.drugAllergies.drugAllergies ?? body.drugAllergies.items;
    if (nested !== undefined) return normalizeStringArray(nested);
  }

  if (body.allergies !== undefined) {
    return normalizeStringArray(body.allergies);
  }

  if (body.drugAllergies !== undefined) {
    return normalizeStringArray(body.drugAllergies);
  }

  return undefined;
};

const formatResidentForDrugAllergiesList = (residentDoc) => {
  const base = formatResident(residentDoc);
  if (!base) return null;
  const allergies = residentDoc?.drugAllergies || [];
  return {
    ...base,
    hasDrugAllergiesRecord: hasDrugAllergiesRecord(residentDoc),
    drugAllergiesCount: allergies.length,
  };
};

const listResidentsForDrugAllergies = async ({ search, status, recorded, page = 1, limit = 20 }) => {
  const normalizedStatus = normalizeResidencyStatusFilter(status);
  const { data, total, page: currentPage, limit: currentLimit } = await residentRepo.findForDrugAllergiesList({
    search,
    status: normalizedStatus,
    recorded,
    page: Math.max(1, parseInt(page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 20)),
  });
  return {
    data: data.map((r) => formatResidentForDrugAllergiesList(r)),
    total,
    page: currentPage,
    limit: currentLimit,
    totalPages: Math.ceil(total / currentLimit) || 0,
  };
};

const getInitialHealth = async (residentIdOrCode) => {
  const residentId = await resolveResidentId(residentIdOrCode);
  const resident = await residentRepo.findInitialHealthByResidentId(residentId);
  if (!resident) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  return { resident: formatResident(resident), initialHealth: mapInitialHealth(resident) };
};

const recordInitialHealth = async (residentIdOrCode, body) => {
  const residentId = await resolveResidentId(residentIdOrCode);
  const description = parseInitialHealthConditionFromBody(body);
  if (!description) {
    throw apiErr(CODES.RESIDENT_HEALTH_CONDITION_REQUIRED, { statusCode: 400 });
  }
  if (description.length < 10) {
    throw apiErr(CODES.RESIDENT_HEALTH_CONDITION_TOO_SHORT, { statusCode: 400, params: { min: 10 } });
  }

  const update = { initialHealthCondition: description };
  const bloodType =
    parseBloodTypeFromBody(body) ??
    (body.initialHealth?.bloodType !== undefined
      ? String(body.initialHealth.bloodType || '').trim() || undefined
      : undefined);
  if (bloodType !== undefined) {
    if (!BLOOD_TYPES.includes(bloodType)) {
      throw apiErr(CODES.RESIDENT_BLOOD_TYPE_INVALID, { statusCode: 400, params: { allowed: BLOOD_TYPES.join(', ') } });
    }
    update.bloodType = bloodType;
  }

  const existing = await residentRepo.findById(residentId);
  if (!existing) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });

  const updated = await residentRepo.updateInitialHealth(residentId, update);
  if (!updated) throw apiErr(CODES.INTERNAL_ERROR, { statusCode: 500 });

  return {
    ...apiSuccess(SUCCESS.RESIDENT_HEALTH_SAVED),
    resident: formatResident(updated),
    initialHealth: mapInitialHealth(updated),
  };
};

const getPreExistingConditions = async (residentIdOrCode) => {
  const residentId = await resolveResidentId(residentIdOrCode);
  const resident = await residentRepo.findPreExistingByResidentId(residentId);
  if (!resident) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  return {
    resident: formatResident(resident),
    preExistingConditions: mapPreExistingConditions(resident),
  };
};

const updatePreExistingConditions = async (residentIdOrCode, body) => {
  const residentId = await resolveResidentId(residentIdOrCode);
  const { chronicConditions: chronic, medicalHistory: history } = parsePreExistingBody(body);
  const update = {};
  if (chronic !== undefined) update.chronicConditions = chronic;
  if (history !== undefined) update.medicalHistory = history;
  if (Object.keys(update).length === 0) {
    throw apiErr(CODES.RESIDENT_MEDICAL_HISTORY_REQUIRED, { statusCode: 400 });
  }
  const updated = await residentRepo.updatePreExistingConditions(residentId, update);
  if (!updated) throw apiErr(CODES.INTERNAL_ERROR, { statusCode: 500 });
  return {
    ...apiSuccess(SUCCESS.RESIDENT_MEDICAL_HISTORY_SAVED),
    resident: formatResident(updated),
    preExistingConditions: mapPreExistingConditions(updated),
  };
};

const getDrugAllergies = async (residentIdOrCode) => {
  const residentId = await resolveResidentId(residentIdOrCode);
  const resident = await residentRepo.findDrugAllergiesByResidentId(residentId);
  if (!resident) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  return {
    resident: formatResident(resident),
    drugAllergies: mapDrugAllergies(resident),
  };
};

const updateDrugAllergies = async (residentIdOrCode, body) => {
  const residentId = await resolveResidentId(residentIdOrCode);
  const parsed = parseDrugAllergiesBody(body);
  if (parsed === undefined) {
    throw apiErr(CODES.RESIDENT_DRUG_ALLERGIES_REQUIRED, { statusCode: 400 });
  }
  const updated = await residentRepo.updateDrugAllergies(residentId, { drugAllergies: parsed });
  if (!updated) throw apiErr(CODES.INTERNAL_ERROR, { statusCode: 500 });
  return {
    ...apiSuccess(SUCCESS.RESIDENT_ALLERGIES_SAVED),
    resident: formatResident(updated),
    drugAllergies: mapDrugAllergies(updated),
  };
};

const adminCreateResident = async (user, body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    throw apiErr(CODES.RESIDENT_BODY_EMPTY, { statusCode: 400 });
  }
  const fullName = body.fullName ? String(body.fullName).trim() : '';
  if (!fullName) throw apiErr(CODES.RESIDENT_FULL_NAME_REQUIRED, { statusCode: 400 });
  const residentCode = body.residentCode ? String(body.residentCode).trim() : null;
  if (residentCode) {
    const existing = await residentRepo.findByResidentCode(residentCode);
    if (existing) throw apiErr(CODES.RESIDENT_CODE_EXISTS, { statusCode: 409 });
  }
  const dateOfBirth = parseOptionalDate(body.dateOfBirth, 'dateOfBirth');
  if (dateOfBirth) {
    const today = new Date();
    let age = today.getFullYear() - dateOfBirth.getFullYear();
    const m = today.getMonth() - dateOfBirth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dateOfBirth.getDate())) {
      age--;
    }
    if (age < 50) {
      throw apiErr(CODES.RESIDENT_AGE_MINIMUM, { statusCode: 400, params: { minAge: 50 } });
    }
  }

  const payload = {
    residentCode: residentCode || (await generateResidentCode()),
    fullName,
    dateOfBirth,
    gender: body.gender || 'unknown',
    citizenId: body.citizenId ? String(body.citizenId).trim() : undefined,
    insuranceNumber: body.insuranceNumber ? String(body.insuranceNumber).trim() : undefined,
    bloodType: body.bloodType || 'unknown',
    personalAddress: body.personalAddress ? String(body.personalAddress).trim() : undefined,
    allergies: normalizeStringArray(body.allergies) || [],
    chronicConditions: normalizeStringArray(body.chronicConditions) || [],
    initialHealthCondition: body.initialHealthCondition ? String(body.initialHealthCondition).trim() : undefined,
    residencyStatus: body.residencyStatus || 'pending',
    admittedAt: parseOptionalDate(body.admittedAt, 'admittedAt'),
    dischargedAt: parseOptionalDate(body.dischargedAt, 'dischargedAt'),
    servicePackage: body.servicePackage ? String(body.servicePackage).trim() : undefined,
  };
  const emergencyContacts = normalizeEmergencyContacts(body.emergencyContacts);
  if (emergencyContacts !== undefined) payload.emergencyContacts = emergencyContacts;
  const familyPortalAccountIds = await normalizeFamilyAccountIds(body.familyPortalAccountIds);
  if (familyPortalAccountIds !== undefined) payload.familyPortalAccountIds = familyPortalAccountIds;
  const resident = await residentRepo.createResident(payload);
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'CREATE_RESIDENT_PROFILE',
    module: 'resident',
    targetEntityType: 'Resident',
    targetEntityId: resident._id,
    afterData: { residentCode: resident.residentCode, fullName: resident.fullName },
    req,
  });
  const populated = await residentRepo.findByIdForAdmin(resident._id);
  return { ...apiSuccess(SUCCESS.RESIDENT_CREATED), resident: formatResident(populated) };
};

const adminListResidents = async (query) => {
  const filter = {};
  if (query.residencyStatus) filter.residencyStatus = query.residencyStatus;
  if (query.gender) filter.gender = query.gender;
  if (query.bloodType) filter.bloodType = query.bloodType;
  if (query.roomId) filter.roomId = query.roomId;
  if (query.bedId) filter.bedId = query.bedId;
  if (query.admittedFrom || query.admittedTo) {
    filter.admittedAt = {};
    const from = startOfDay(query.admittedFrom, 'admittedFrom');
    const to = endOfDay(query.admittedTo, 'admittedTo');
    if (from) filter.admittedAt.$gte = from;
    if (to) filter.admittedAt.$lte = to;
  }
  if (query.search) {
    const term = String(query.search).trim();
    if (term) {
      filter.$or = [
        { residentCode: { $regex: term, $options: 'i' } },
        { fullName: { $regex: term, $options: 'i' } },
        { citizenId: { $regex: term, $options: 'i' } },
        { insuranceNumber: { $regex: term, $options: 'i' } },
      ];
    }
  }
  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    residentRepo.findAll(filter, { sort: { createdAt: -1 }, skip, limit: limitNum }),
    residentRepo.countAll(filter),
  ]);
  return { data: data.map(formatResident), total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) || 1 };
};

const adminGetResident = async (residentId) => {
  const resident = await residentRepo.findByIdForAdmin(residentId);
  if (!resident) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  return { resident: formatResident(resident) };
};

const adminUpdatePersonalInfo = async (user, residentId, body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) throw apiErr(CODES.RESIDENT_BODY_EMPTY, { statusCode: 400 });
  const role = String(user?.role || '').toLowerCase();
  if (body.allergies !== undefined && (role === 'admin' || role === 'manager')) {
    throw apiErr(CODES.RESIDENT_DRUG_ALLERGIES_FORBIDDEN, { statusCode: 403 });
  }
  const update = {};
  if (body.fullName !== undefined) {
    const fullName = String(body.fullName).trim();
    if (!fullName) throw apiErr(CODES.RESIDENT_VALIDATION_FAILED, { statusCode: 400, params: { detail: 'fullName không được để trống' } });
    update.fullName = fullName;
  }
  if (body.dateOfBirth !== undefined) {
    const dob = parseOptionalDate(body.dateOfBirth, 'dateOfBirth');
    if (dob) {
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
        age--;
      }
      if (age < 50) {
        throw apiErr(CODES.RESIDENT_AGE_MINIMUM, { statusCode: 400, params: { minAge: 50 } });
      }
    }
    update.dateOfBirth = dob;
  }
  if (body.gender !== undefined) update.gender = body.gender;
  if (body.citizenId !== undefined) update.citizenId = String(body.citizenId || '').trim() || undefined;
  if (body.insuranceNumber !== undefined) update.insuranceNumber = String(body.insuranceNumber || '').trim() || undefined;
  if (body.bloodType !== undefined) update.bloodType = body.bloodType;
  if (body.personalAddress !== undefined) update.personalAddress = String(body.personalAddress || '').trim() || undefined;
  if (body.avatarUrl !== undefined) update.avatarUrl = String(body.avatarUrl || '').trim() || undefined;
  const allergies = normalizeStringArray(body.allergies);
  if (allergies !== undefined) update.allergies = allergies;
  const chronicConditions = normalizeStringArray(body.chronicConditions);
  if (chronicConditions !== undefined) update.chronicConditions = chronicConditions;
  if (body.initialHealthCondition !== undefined) update.initialHealthCondition = String(body.initialHealthCondition || '').trim() || undefined;
  if (Object.keys(update).length === 0) throw apiErr(CODES.RESIDENT_PERSONAL_INFO_NO_FIELDS, { statusCode: 400 });
  const before = await residentRepo.findByIdForAdmin(residentId);
  if (!before) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  const updated = await residentRepo.updateById(residentId, update);
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'UPDATE_RESIDENT_PERSONAL_INFO',
    module: 'resident',
    targetEntityType: 'Resident',
    targetEntityId: residentId,
    beforeData: { fullName: before.fullName, citizenId: before.citizenId },
    afterData: { fullName: updated.fullName, citizenId: updated.citizenId },
    req,
  });
  return { ...apiSuccess(SUCCESS.RESIDENT_UPDATED), resident: formatResident(updated) };
};

const adminUpdateFamilyInfo = async (user, residentId, body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) throw apiErr(CODES.RESIDENT_BODY_EMPTY, { statusCode: 400 });
  const update = {};
  const emergencyContacts = normalizeEmergencyContacts(body.emergencyContacts);
  if (emergencyContacts !== undefined) update.emergencyContacts = emergencyContacts;
  const familyPortalAccountIds = await normalizeFamilyAccountIds(body.familyPortalAccountIds);
  if (familyPortalAccountIds !== undefined) update.familyPortalAccountIds = familyPortalAccountIds;
  if (Object.keys(update).length === 0) throw apiErr(CODES.RESIDENT_FAMILY_INFO_NO_FIELDS, { statusCode: 400 });
  const before = await residentRepo.findByIdForAdmin(residentId);
  if (!before) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });
  if (emergencyContacts !== undefined) {
    assertPrimaryContactNotRemoved(before.emergencyContacts, emergencyContacts);
  }
  const updated = await residentRepo.updateById(residentId, update);
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'UPDATE_RESIDENT_FAMILY_INFO',
    module: 'resident',
    targetEntityType: 'Resident',
    targetEntityId: residentId,
    beforeData: { familyPortalAccountIds: before.familyPortalAccountIds },
    afterData: { familyPortalAccountIds: updated.familyPortalAccountIds },
    req,
  });
  return { ...apiSuccess(SUCCESS.RESIDENT_UPDATED), resident: formatResident(updated) };
};

const adminUploadAvatar = async (user, residentId, file, req) => {
  if (!file || !file.buffer) throw apiErr(CODES.RESIDENT_FILE_REQUIRED, { statusCode: 400 });
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.mimetype)) throw apiErr(CODES.RESIDENT_FILE_TYPE_UNSUPPORTED, { statusCode: 400 });
  if (file.size > 5 * 1024 * 1024) throw apiErr(CODES.RESIDENT_FILE_TOO_LARGE, { statusCode: 400 });

  const { uploadImageBuffer, isCloudinaryConfigured } = require('../utils/cloudinaryUpload');
  if (!isCloudinaryConfigured()) {
    throw apiErr(CODES.RESIDENT_CLOUDINARY_NOT_CONFIGURED, { statusCode: 400 });
  }

  let uploadResult;
  try {
    uploadResult = await uploadImageBuffer(file.buffer, {
      folder: 'residents',
      mimeType: file.mimetype,
      options: { use_filename: true, unique_filename: false },
    });
  } catch (uploadErr) {
    console.error('Cloudinary upload error:', uploadErr);
    throw apiErr(CODES.INTERNAL_ERROR, { statusCode: 500, message: uploadErr.message || undefined });
  }

  const before = await residentRepo.findByIdForAdmin(residentId);
  if (!before) throw apiErr(CODES.RESIDENT_NOT_FOUND, { statusCode: 404 });

  const updated = await residentRepo.updateById(residentId, { avatarUrl: uploadResult.secure_url });

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'UPLOAD_RESIDENT_AVATAR',
    module: 'resident',
    targetEntityType: 'Resident',
    targetEntityId: residentId,
    beforeData: { avatarUrl: before.avatarUrl },
    afterData: { avatarUrl: updated.avatarUrl },
    req,
  });

  return { ...apiSuccess(SUCCESS.RESIDENT_AVATAR_UPDATED), resident: formatResident(updated) };
};

module.exports = {
  listResidentsForAssignment,
  listResidentsForFamilyManagement,
  getResidentFamilyInfo,
  addEmergencyContact,
  replaceEmergencyContacts,
  updateEmergencyContact,
  removeEmergencyContact,
  getResidentsAreaSummary,
  listResidentsByArea,
  getResidentDetail,
  getTransferTargets,
  transferResidentToRoom,
  adminReleaseResident,
  listResidentsForInitialHealth,
  listResidentsForPreExisting,
  listResidentsForDrugAllergies,
  getInitialHealth,
  recordInitialHealth,
  getPreExistingConditions,
  updatePreExistingConditions,
  getDrugAllergies,
  updateDrugAllergies,
  adminCreateResident,
  adminUploadAvatar,
  adminListResidents,
  adminGetResident,
  adminUpdatePersonalInfo,
  adminUpdateFamilyInfo,
};

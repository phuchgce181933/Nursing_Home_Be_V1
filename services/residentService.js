const { Types } = require('mongoose');
const ServiceError = require('./serviceError');
const residentRepo = require('../repositories/residentRepository');
const roomRepo = require('../repositories/roomRepository');
const bedRepo = require('../repositories/bedRepository');
const floorRepo = require('../repositories/floorRepository');
const { GENDERS, BLOOD_TYPES, RESIDENCY_STATUSES } = require('../models/enums');
const { validateFullName, validatePhone } = require('../utils/validators');
const User = require('../models/user');
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
    throw new ServiceError(`${fieldName} không hợp lệ`, 400);
  }
  return date;
};

const normalizeStringArray = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return [String(value).trim()].filter(Boolean);
};

const normalizeEmergencyContacts = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) throw new ServiceError('emergencyContacts phải là mảng', 400);
  return value.map((contact, index) => {
    if (!contact || typeof contact !== 'object') {
      throw new ServiceError(`emergencyContacts[${index}] phải là object`, 400);
    }
    const fullName = String(contact.fullName || '').trim();
    const relationship = String(contact.relationship || '').trim();
    const phone = String(contact.phone || '').trim();
    if (!fullName || !relationship || !phone) {
      throw new ServiceError(`emergencyContacts[${index}] phải có đầy đủ fullName, relationship và phone`, 400);
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
};

const normalizeFamilyAccountIds = async (value) => {
  if (value === undefined) return undefined;
  if (value === null) return [];
  const rawIds = Array.isArray(value) ? value : [value];
  const ids = rawIds.map((id) => String(id).trim()).filter(Boolean);
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];
  const invalidIds = uniqueIds.filter((id) => !Types.ObjectId.isValid(id));
  if (invalidIds.length) throw new ServiceError(`familyPortalAccountIds không hợp lệ: ${invalidIds.join(', ')}`, 400);
  const users = await User.find({ _id: { $in: uniqueIds }, role: 'family' }).select('_id');
  if (users.length !== uniqueIds.length) {
    throw new ServiceError('Một số familyPortalAccountIds không tồn tại hoặc không phải tài khoản family', 400);
  }
  return uniqueIds;
};

const generateResidentCode = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `RES${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const exists = await residentRepo.findByResidentCode(code);
    if (!exists) return code;
  }
  throw new ServiceError('Không thể tạo residentCode', 500);
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
  const floorName = floor?.name || (floor?.floorNumber != null ? `Tang ${floor.floorNumber}` : null);
  const buildingName = building?.name || building?.code;
  return {
    room: {
      _id: room._id,
      roomNumber: room.roomNumber,
      roomType: room.roomType,
      label: room.roomNumber ? `Phong ${room.roomNumber}` : null,
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
  if (!residentRepo.assertValidObjectId(residentId)) throw new ServiceError('residentId không hợp lệ', 400);
};

/** Resolve MongoDB resident _id from ObjectId string or residentCode (e.g. RES001). */
const resolveResidentId = async (residentIdOrCode) => {
  const raw = String(residentIdOrCode || '').trim();
  if (!raw) throw new ServiceError('residentId là bắt buộc', 400);

  if (residentRepo.assertValidObjectId(raw)) {
    const byId = await residentRepo.findById(raw);
    if (byId) return byId._id;
  }

  const byCode = await residentRepo.findByResidentCode(raw);
  if (byCode) return byCode._id;

  throw new ServiceError('Không tìm thấy cư dân', 404);
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
  if (!residentRepo.assertValidObjectId(contactId)) throw new ServiceError('contactId không hợp lệ', 400);
};

const assertObjectId = (value, label) => {
  if (!residentRepo.assertValidObjectId(value)) throw new ServiceError(`${label} không hợp lệ`, 400);
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
  if (errors.length) throw new ServiceError(errors.join('; '), 400);
  return normalizeContactInput(contact, { partial });
};

const ensureSinglePrimary = (contacts) => {
  const primaryCount = contacts.filter((c) => c.isPrimary).length;
  if (primaryCount > 1) throw new ServiceError('Chỉ được đánh dấu tối đa một liên hệ khẩn cấp là chính', 400);
};

const CANNOT_DELETE_PRIMARY_MSG =
  'Không thể xóa liên hệ chính. Vui lòng đặt liên hệ khác làm chính trước.';

const matchEmergencyContact = (a, b) => {
  const aId = a?._id?.toString?.();
  const bId = b?._id?.toString?.();
  if (aId && bId && aId === bId) return true;
  return a?.fullName === b?.fullName && a?.phone === b?.phone;
};

const assertPrimaryContactNotRemoved = (existingContacts, nextContacts) => {
  const primaryBefore = (existingContacts || []).find((c) => c.isPrimary);
  if (!primaryBefore) return;

  const stillPresent = (nextContacts || []).some((c) => matchEmergencyContact(c, primaryBefore));
  if (stillPresent) return;

  const hasNewPrimary = (nextContacts || []).some((c) => c.isPrimary);
  if (!hasNewPrimary) throw new ServiceError(CANNOT_DELETE_PRIMARY_MSG, 400);
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
  let queryStatus = status || 'admitted';
  if (status && String(status).includes(',')) {
    const statuses = String(status)
      .split(',')
      .map((s) => s.trim());
    statuses.forEach((s) => {
      if (!RESIDENCY_STATUSES.includes(s)) {
        throw new ServiceError(`status phải thuộc một trong: ${RESIDENCY_STATUSES.join(', ')}`, 400);
      }
    });
    queryStatus = statuses;
  } else if (status && !RESIDENCY_STATUSES.includes(status)) {
    throw new ServiceError(`status phải thuộc một trong: ${RESIDENCY_STATUSES.join(', ')}`, 400);
  }
  return queryStatus;
};

const listResidentsForAssignment = async ({ floorId, roomId, search, status }, user) => {
  const queryStatus = parseAssignmentStatusFilter(status);

  let residentIds = null;
  if (user && ['doctor', 'nurse'].includes(user.role)) {
    const staffProfileRepo = require('../repositories/staffProfileRepository');
    const profile = await staffProfileRepo.findByUserId(user._id);
    if (!profile) throw new ServiceError('Staff profile not found for this account', 404);

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
  return { data, total: data.length };
};

const listResidentsForFamilyManagement = async ({ search, status, page = 1, limit = 20 }) => {
  const queryStatus = parseAssignmentStatusFilter(status);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
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
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);
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
  const resident = await residentRepo.addEmergencyContact(residentId, contact);
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);
  const added = resident.emergencyContacts[resident.emergencyContacts.length - 1];
  return { message: 'Thêm liên hệ khẩn cấp thành công', emergencyContact: added, emergencyContacts: resident.emergencyContacts };
};

const replaceEmergencyContacts = async (residentId, contactsInput) => {
  assertResidentId(residentId);
  if (!Array.isArray(contactsInput)) throw new ServiceError('contacts phải là mảng', 400);
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
  const existing = await residentRepo.findById(residentId);
  if (!existing) throw new ServiceError('Không tìm thấy cư dân', 404);
  assertPrimaryContactNotRemoved(existing.emergencyContacts, normalized);
  const resident = await residentRepo.replaceEmergencyContacts(residentId, normalized);
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);
  return { message: 'Cập nhật liên hệ khẩn cấp thành công', emergencyContacts: resident.emergencyContacts };
};

const updateEmergencyContact = async (residentId, contactId, body) => {
  assertResidentId(residentId);
  assertContactId(contactId);
  const patch = validateContactPayload(body, { requireAll: false, partial: true });
  const resident = await residentRepo.updateEmergencyContact(residentId, contactId, patch);
  if (!resident) {
    const exists = await residentRepo.findById(residentId);
    if (!exists) throw new ServiceError('Không tìm thấy cư dân', 404);
    throw new ServiceError('Không tìm thấy liên hệ khẩn cấp', 404);
  }
  const updated = resident.emergencyContacts.id(contactId);
  return { message: 'Cập nhật liên hệ khẩn cấp thành công', emergencyContact: updated, emergencyContacts: resident.emergencyContacts };
};

const removeEmergencyContact = async (residentId, contactId) => {
  assertResidentId(residentId);
  assertContactId(contactId);
  const existing = await residentRepo.findById(residentId);
  if (!existing) throw new ServiceError('Không tìm thấy cư dân', 404);
  const contact = existing.emergencyContacts?.id?.(contactId);
  if (!contact) throw new ServiceError('Không tìm thấy liên hệ khẩn cấp', 404);
  if (contact.isPrimary) throw new ServiceError(CANNOT_DELETE_PRIMARY_MSG, 400);
  const resident = await residentRepo.removeEmergencyContact(residentId, contactId);
  return { message: 'Xóa liên hệ khẩn cấp thành công', emergencyContacts: resident.emergencyContacts };
};

const assertAreaFilter = ({ buildingId, floorId, roomId }) => {
  if (!buildingId && !floorId && !roomId) throw new ServiceError('buildingId, floorId hoặc roomId là bắt buộc', 400);
  if (buildingId && !residentRepo.assertValidObjectId(buildingId)) throw new ServiceError('buildingId không hợp lệ', 400);
  if (floorId && !residentRepo.assertValidObjectId(floorId)) throw new ServiceError('floorId không hợp lệ', 400);
  if (roomId && !residentRepo.assertValidObjectId(roomId)) throw new ServiceError('roomId không hợp lệ', 400);
};

const mapResolveError = (error) => {
  const messages = {
    room_not_found: 'Không tìm thấy phòng',
    floor_not_found: 'Không tìm thấy tầng',
    room_floor_mismatch: 'roomId does not belong to the specified floorId',
    room_building_mismatch: 'roomId does not belong to the specified buildingId',
    floor_building_mismatch: 'floorId does not belong to the specified buildingId',
  };
  if (error && messages[error]) throw new ServiceError(messages[error], 400);
};

const getResidentsAreaSummary = async ({ buildingId, status }) => {
  if (buildingId && !residentRepo.assertValidObjectId(buildingId)) throw new ServiceError('buildingId không hợp lệ', 400);
  if (status && !RESIDENCY_STATUSES.includes(status)) {
    throw new ServiceError(`status phải thuộc một trong: ${RESIDENCY_STATUSES.join(', ')}`, 400);
  }
  return residentRepo.getAreaSummary({ buildingId, status: status || 'admitted' });
};

const listResidentsByArea = async ({ buildingId, floorId, roomId, search, status, page = 1, limit = 20 }) => {
  assertAreaFilter({ buildingId, floorId, roomId });
  const normalizedStatus = normalizeResidencyStatusFilter(status);
  if (normalizedStatus && !RESIDENCY_STATUSES.includes(normalizedStatus)) {
    throw new ServiceError(`status phải thuộc một trong: ${RESIDENCY_STATUSES.join(', ')}`, 400);
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
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);
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
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);
  if (resident.residencyStatus !== 'admitted') throw new ServiceError('Chỉ cư dân đang ở trạng thái admitted mới được chuyển phòng', 400);
  if (!resident.roomId || !resident.bedId) throw new ServiceError('Cư dân hiện chưa được gán phòng/giường', 400);

  const floor = await floorRepo.findById(floorId);
  if (!floor) throw new ServiceError('Không tìm thấy tầng', 404);
  const rooms = await roomRepo.findByFloorId(floorId);
  const roomIds = rooms.map((room) => room._id);
  const availableBeds = await bedRepo.findAvailableByRoomIds(roomIds);
  const bedsByRoomId = new Map();
  for (const bed of availableBeds) {
    const key = String(bed.roomId);
    if (!bedsByRoomId.has(key)) bedsByRoomId.set(key, []);
    bedsByRoomId.get(key).push({ _id: bed._id, bedCode: bed.bedCode, bedType: bed.bedType, status: bed.status });
  }
  const currentRoomId = String(resident.roomId?._id || resident.roomId);
  const targets = rooms
    .map((room) => ({
      _id: room._id,
      roomNumber: room.roomNumber,
      roomType: room.roomType,
      capacity: room.capacity,
      occupiedCount: room.occupiedCount,
      status: room.status,
      availableBeds: bedsByRoomId.get(String(room._id)) || [],
    }))
    .filter(
      (room) =>
        String(room._id) !== currentRoomId &&
        room.availableBeds.length > 0
    );

  const message =
    targets.length === 0
      ? 'Không có phòng/giường trống trên tầng đã chọn. Chọn tầng khác hoặc giải phóng giường trước.'
      : undefined;

  return {
    resident: {
      _id: resident._id,
      residentCode: resident.residentCode,
      fullName: resident.fullName,
      residencyStatus: resident.residencyStatus,
    },
    currentAssignment: mapTransferAssignment(resident),
    targets,
    message,
  };
};

const transferResidentToRoom = async (residentId, { targetRoomId, targetBedId }) => {
  assertResidentId(residentId);
  assertObjectId(targetRoomId, 'targetRoomId');
  assertObjectId(targetBedId, 'targetBedId');
  const resident = await residentRepo.findByIdForTransfer(residentId);
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);
  if (resident.residencyStatus !== 'admitted') throw new ServiceError('Chỉ cư dân đang ở trạng thái admitted mới được chuyển phòng', 400);
  if (!resident.roomId || !resident.bedId) throw new ServiceError('Cư dân hiện chưa được gán phòng/giường', 400);
  if (String(resident.bedId._id) === String(targetBedId)) throw new ServiceError('Cư dân đã nằm ở giường này', 400);

  const targetRoom = await roomRepo.findById(targetRoomId);
  if (!targetRoom) throw new ServiceError('Không tìm thấy phòng đích', 404);
  if (targetRoom.status === 'closed') throw new ServiceError('Phòng đích đang đóng', 400);
  if (targetRoom.occupiedCount >= targetRoom.capacity) throw new ServiceError('Phòng đích đã đầy', 400);

  const targetBed = await bedRepo.findById(targetBedId);
  if (!targetBed) throw new ServiceError('Không tìm thấy giường đích', 404);
  if (String(targetBed.roomId) !== String(targetRoomId)) throw new ServiceError('targetBedId không thuộc targetRoomId', 400);
  if (targetBed.status !== 'available' || targetBed.assignedResidentId) throw new ServiceError('Giường đích không khả dụng', 400);

  await bedRepo.releaseBed(resident.bedId._id, new Date());
  await roomRepo.adjustOccupiedCount(resident.roomId._id, -1);
  await bedRepo.occupyBed(targetBedId, resident._id, new Date());
  await roomRepo.adjustOccupiedCount(targetRoomId, 1);

  const updatedResident = await residentRepo.updateRoomAssignment(residentId, { roomId: targetRoomId, bedId: targetBedId });
  if (!updatedResident) throw new ServiceError('Không tìm thấy cư dân', 404);

  const targetFloorId = targetRoom.floorId?._id || targetRoom.floorId;
  const staffAreasSynced = await syncStaffAreasAfterResidentTransfer(residentId, {
    targetRoomId,
    targetFloorId,
  });

  return {
    message: 'Chuyển cư dân thành công',
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
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);
  return { resident: formatResident(resident), initialHealth: mapInitialHealth(resident) };
};

const recordInitialHealth = async (residentIdOrCode, body) => {
  const residentId = await resolveResidentId(residentIdOrCode);
  const description = parseInitialHealthConditionFromBody(body);
  if (!description) {
    throw new ServiceError('initialHealthCondition là bắt buộc', 400);
  }
  if (description.length < 10) {
    throw new ServiceError('initialHealthCondition phải có ít nhất 10 ký tự', 400);
  }

  const update = { initialHealthCondition: description };
  const bloodType =
    parseBloodTypeFromBody(body) ??
    (body.initialHealth?.bloodType !== undefined
      ? String(body.initialHealth.bloodType || '').trim() || undefined
      : undefined);
  if (bloodType !== undefined) {
    if (!BLOOD_TYPES.includes(bloodType)) {
      throw new ServiceError(`bloodType phải thuộc một trong: ${BLOOD_TYPES.join(', ')}`, 400);
    }
    update.bloodType = bloodType;
  }

  const existing = await residentRepo.findById(residentId);
  if (!existing) throw new ServiceError('Không tìm thấy cư dân', 404);

  const updated = await residentRepo.updateInitialHealth(residentId, update);
  if (!updated) throw new ServiceError('Lưu tình trạng sức khỏe ban đầu thất bại', 500);

  return {
    message: hasInitialHealthRecord(existing)
      ? 'Cập nhật tình trạng sức khỏe ban đầu thành công'
      : 'Ghi nhận tình trạng sức khỏe ban đầu thành công',
    resident: formatResident(updated),
    initialHealth: mapInitialHealth(updated),
  };
};

const getPreExistingConditions = async (residentIdOrCode) => {
  const residentId = await resolveResidentId(residentIdOrCode);
  const resident = await residentRepo.findPreExistingByResidentId(residentId);
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);
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
    throw new ServiceError('Cần cung cấp ít nhất một trong hai: chronicConditions hoặc medicalHistory', 400);
  }
  const updated = await residentRepo.updatePreExistingConditions(residentId, update);
  if (!updated) throw new ServiceError('Lưu bệnh nền/tiền sử bệnh thất bại', 500);
  return {
    message: 'Cập nhật bệnh nền/tiền sử bệnh thành công',
    resident: formatResident(updated),
    preExistingConditions: mapPreExistingConditions(updated),
  };
};

const getDrugAllergies = async (residentIdOrCode) => {
  const residentId = await resolveResidentId(residentIdOrCode);
  const resident = await residentRepo.findDrugAllergiesByResidentId(residentId);
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);
  return {
    resident: formatResident(resident),
    drugAllergies: mapDrugAllergies(resident),
  };
};

const updateDrugAllergies = async (residentIdOrCode, body) => {
  const residentId = await resolveResidentId(residentIdOrCode);
  const parsed = parseDrugAllergiesBody(body);
  if (parsed === undefined) {
    throw new ServiceError('drugAllergies là bắt buộc (kiểu mảng, có thể rỗng)', 400);
  }
  const updated = await residentRepo.updateDrugAllergies(residentId, { drugAllergies: parsed });
  if (!updated) throw new ServiceError('Lưu dị ứng thuốc thất bại', 500);
  return {
    message: 'Cập nhật dị ứng thuốc thành công',
    resident: formatResident(updated),
    drugAllergies: mapDrugAllergies(updated),
  };
};

const adminCreateResident = async (user, body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    throw new ServiceError('Nội dung request body rỗng hoặc parse thất bại. Hãy dùng POST với Header Content-Type: application/json và Body raw JSON.', 400);
  }
  const fullName = body.fullName ? String(body.fullName).trim() : '';
  if (!fullName) throw new ServiceError('fullName là bắt buộc', 400);
  const residentCode = body.residentCode ? String(body.residentCode).trim() : null;
  if (residentCode) {
    const existing = await residentRepo.findByResidentCode(residentCode);
    if (existing) throw new ServiceError('residentCode đã tồn tại', 409);
  }
  const payload = {
    residentCode: residentCode || (await generateResidentCode()),
    fullName,
    dateOfBirth: parseOptionalDate(body.dateOfBirth, 'dateOfBirth'),
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
  return { message: 'Tạo hồ sơ cư dân thành công', resident: formatResident(populated) };
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
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);
  return { resident: formatResident(resident) };
};

const adminUpdatePersonalInfo = async (user, residentId, body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) throw new ServiceError('Nội dung request body rỗng', 400);
  const update = {};
  if (body.fullName !== undefined) {
    const fullName = String(body.fullName).trim();
    if (!fullName) throw new ServiceError('fullName không được để trống', 400);
    update.fullName = fullName;
  }
  if (body.dateOfBirth !== undefined) update.dateOfBirth = parseOptionalDate(body.dateOfBirth, 'dateOfBirth');
  if (body.gender !== undefined) update.gender = body.gender;
  if (body.citizenId !== undefined) update.citizenId = String(body.citizenId || '').trim() || undefined;
  if (body.insuranceNumber !== undefined) update.insuranceNumber = String(body.insuranceNumber || '').trim() || undefined;
  if (body.bloodType !== undefined) update.bloodType = body.bloodType;
  if (body.personalAddress !== undefined) update.personalAddress = String(body.personalAddress || '').trim() || undefined;
  const allergies = normalizeStringArray(body.allergies);
  if (allergies !== undefined) update.allergies = allergies;
  const chronicConditions = normalizeStringArray(body.chronicConditions);
  if (chronicConditions !== undefined) update.chronicConditions = chronicConditions;
  if (body.initialHealthCondition !== undefined) update.initialHealthCondition = String(body.initialHealthCondition || '').trim() || undefined;
  if (Object.keys(update).length === 0) throw new ServiceError('Không có trường thông tin cá nhân hợp lệ để cập nhật', 400);
  const before = await residentRepo.findByIdForAdmin(residentId);
  if (!before) throw new ServiceError('Không tìm thấy cư dân', 404);
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
  return { message: 'Cập nhật thông tin cá nhân cư dân thành công', resident: formatResident(updated) };
};

const adminUpdateFamilyInfo = async (user, residentId, body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) throw new ServiceError('Nội dung request body rỗng', 400);
  const update = {};
  const emergencyContacts = normalizeEmergencyContacts(body.emergencyContacts);
  if (emergencyContacts !== undefined) update.emergencyContacts = emergencyContacts;
  const familyPortalAccountIds = await normalizeFamilyAccountIds(body.familyPortalAccountIds);
  if (familyPortalAccountIds !== undefined) update.familyPortalAccountIds = familyPortalAccountIds;
  if (Object.keys(update).length === 0) throw new ServiceError('Không có trường thông tin gia đình hợp lệ để cập nhật', 400);
  const before = await residentRepo.findByIdForAdmin(residentId);
  if (!before) throw new ServiceError('Không tìm thấy cư dân', 404);
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
  return { message: 'Cập nhật thông tin gia đình cư dân thành công', resident: formatResident(updated) };
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
  adminListResidents,
  adminGetResident,
  adminUpdatePersonalInfo,
  adminUpdateFamilyInfo,
};

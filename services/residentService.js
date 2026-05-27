const ServiceError = require('./serviceError');
const residentRepo = require('../repositories/residentRepository');
const roomRepo = require('../repositories/roomRepository');
const bedRepo = require('../repositories/bedRepository');
const floorRepo = require('../repositories/floorRepository');
const { RESIDENCY_STATUSES, BLOOD_TYPES } = require('../models/enums');
const { validateFullName, validatePhone } = require('../utils/validators');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const assertResidentId = (residentId) => {
  if (!residentRepo.assertValidObjectId(residentId)) {
    throw new ServiceError('Invalid resident id', 400);
  }
};

const assertContactId = (contactId) => {
  if (!residentRepo.assertValidObjectId(contactId)) {
    throw new ServiceError('Invalid contact id', 400);
  }
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
  if (!partial || body.email !== undefined) {
    out.email = body.email?.trim() ? body.email.trim().toLowerCase() : undefined;
  }
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
    if (!contact.relationship) errors.push('relationship is required');
  }

  if (requireAll || contact.phone !== undefined) {
    if (!contact.phone) errors.push('phone is required');
    else {
      const phoneErr = validatePhone(contact.phone);
      if (phoneErr) errors.push(phoneErr);
    }
  }

  if (contact.email !== undefined) {
    const emailErr = validateOptionalEmail(contact.email);
    if (emailErr) errors.push(emailErr);
  }

  if (errors.length) {
    throw new ServiceError(errors.join('; '), 400);
  }

  return normalizeContactInput(contact, { partial });
};

const ensureSinglePrimary = (contacts) => {
  let primaryCount = 0;
  for (const c of contacts) {
    if (c.isPrimary) primaryCount += 1;
  }
  if (primaryCount > 1) {
    throw new ServiceError('Only one emergency contact can be marked as primary', 400);
  }
};

const mapResidentFamilySummary = (resident) => ({
  _id: resident._id,
  residentCode: resident.residentCode,
  fullName: resident.fullName,
  roomId: resident.roomId,
  residencyStatus: resident.residencyStatus,
  emergencyContactCount: resident.emergencyContacts?.length ?? 0,
});

const listResidentsForAssignment = async ({ floorId, roomId, search, status }) => {
  if (status && !RESIDENCY_STATUSES.includes(status)) {
    throw new ServiceError(`status must be one of: ${RESIDENCY_STATUSES.join(', ')}`, 400);
  }

  const data = await residentRepo.findForAssignment({
    floorId,
    roomId,
    search,
    status: status || 'admitted',
  });

  return { data, total: data.length };
};

const listResidentsForFamilyManagement = async ({
  search,
  status,
  page = 1,
  limit = 20,
}) => {
  if (status && !RESIDENCY_STATUSES.includes(status)) {
    throw new ServiceError(`status must be one of: ${RESIDENCY_STATUSES.join(', ')}`, 400);
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const { data, total, page: currentPage, limit: currentLimit } =
    await residentRepo.findForFamilyManagement({
      search,
      status: status || 'admitted',
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
  if (!resident) throw new ServiceError('Resident not found', 404);

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
  if (!resident) throw new ServiceError('Resident not found', 404);

  const added = resident.emergencyContacts[resident.emergencyContacts.length - 1];
  return {
    message: 'Emergency contact added',
    emergencyContact: added,
    emergencyContacts: resident.emergencyContacts,
  };
};

const replaceEmergencyContacts = async (residentId, contactsInput) => {
  assertResidentId(residentId);

  if (!Array.isArray(contactsInput)) {
    throw new ServiceError('contacts must be an array', 400);
  }

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

  const resident = await residentRepo.replaceEmergencyContacts(residentId, normalized);
  if (!resident) throw new ServiceError('Resident not found', 404);

  return {
    message: 'Emergency contacts updated',
    emergencyContacts: resident.emergencyContacts,
  };
};

const updateEmergencyContact = async (residentId, contactId, body) => {
  assertResidentId(residentId);
  assertContactId(contactId);

  const patch = validateContactPayload(body, { requireAll: false, partial: true });
  const resident = await residentRepo.updateEmergencyContact(residentId, contactId, patch);
  if (!resident) {
    const exists = await residentRepo.findById(residentId);
    if (!exists) throw new ServiceError('Resident not found', 404);
    throw new ServiceError('Emergency contact not found', 404);
  }

  const updated = resident.emergencyContacts.id(contactId);
  return {
    message: 'Emergency contact updated',
    emergencyContact: updated,
    emergencyContacts: resident.emergencyContacts,
  };
};

const removeEmergencyContact = async (residentId, contactId) => {
  assertResidentId(residentId);
  assertContactId(contactId);

  const resident = await residentRepo.removeEmergencyContact(residentId, contactId);
  if (!resident) {
    const exists = await residentRepo.findById(residentId);
    if (!exists) throw new ServiceError('Resident not found', 404);
    throw new ServiceError('Emergency contact not found', 404);
  }

  return {
    message: 'Emergency contact removed',
    emergencyContacts: resident.emergencyContacts,
  };
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
  const floorName = floor?.name || (floor?.floorNumber != null ? `Tầng ${floor.floorNumber}` : null);
  const buildingName = building?.name || building?.code;

  return {
    room: {
      _id: room._id,
      roomNumber: room.roomNumber,
      roomType: room.roomType,
      label: room.roomNumber ? `Phòng ${room.roomNumber}` : null,
    },
    floor: floor
      ? {
          _id: floor._id,
          name: floor.name,
          floorNumber: floor.floorNumber,
          label: buildingName && floorName ? `${floorName} — ${buildingName}` : floorName,
        }
      : null,
    building: building
      ? {
          _id: building._id,
          code: building.code,
          name: building.name,
        }
      : null,
  };
};

const mapResidentByAreaItem = (resident) => {
  const { room, floor, building } = mapAreaFromRoom(resident.roomId);
  return {
    _id: resident._id,
    residentCode: resident.residentCode,
    fullName: resident.fullName,
    age: calcAge(resident.dateOfBirth),
    gender: resident.gender,
    bloodType: resident.bloodType,
    residencyStatus: resident.residencyStatus,
    admittedAt: resident.admittedAt,
    chronicConditions: resident.chronicConditions || [],
    room,
    floor,
    building,
    bed: resident.bedId
      ? { _id: resident.bedId._id, bedCode: resident.bedId.bedCode, status: resident.bedId.status }
      : null,
  };
};

const mapResidentDetail = (resident) => {
  const { room, floor, building } = mapAreaFromRoom(resident.roomId);
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
    allergies: resident.allergies || [],
    chronicConditions: resident.chronicConditions || [],
    medicalHistory: resident.medicalHistory || [],
    initialHealthCondition: resident.initialHealthCondition,
    residencyStatus: resident.residencyStatus,
    admittedAt: resident.admittedAt,
    dischargedAt: resident.dischargedAt,
    servicePackage: resident.servicePackage,
    emergencyContactCount: resident.emergencyContacts?.length ?? 0,
    area: {
      room,
      floor,
      building,
      bed: resident.bedId
        ? {
            _id: resident.bedId._id,
            bedCode: resident.bedId.bedCode,
            status: resident.bedId.status,
            bedType: resident.bedId.bedType,
          }
        : null,
    },
    createdAt: resident.createdAt,
    updatedAt: resident.updatedAt,
  };
};

const assertAreaFilter = ({ buildingId, floorId, roomId }) => {
  if (!buildingId && !floorId && !roomId) {
    throw new ServiceError('buildingId, floorId, or roomId is required', 400);
  }
  if (buildingId && !residentRepo.assertValidObjectId(buildingId)) {
    throw new ServiceError('Invalid buildingId', 400);
  }
  if (floorId && !residentRepo.assertValidObjectId(floorId)) {
    throw new ServiceError('Invalid floorId', 400);
  }
  if (roomId && !residentRepo.assertValidObjectId(roomId)) {
    throw new ServiceError('Invalid roomId', 400);
  }
};

const mapResolveError = (error) => {
  const messages = {
    room_not_found: 'Room not found',
    floor_not_found: 'Floor not found',
    room_floor_mismatch: 'roomId does not belong to the specified floorId',
    room_building_mismatch: 'roomId does not belong to the specified buildingId',
    floor_building_mismatch: 'floorId does not belong to the specified buildingId',
  };
  if (error && messages[error]) {
    throw new ServiceError(messages[error], 400);
  }
};

const getResidentsAreaSummary = async ({ buildingId, status }) => {
  if (buildingId && !residentRepo.assertValidObjectId(buildingId)) {
    throw new ServiceError('Invalid buildingId', 400);
  }
  if (status && !RESIDENCY_STATUSES.includes(status)) {
    throw new ServiceError(`status must be one of: ${RESIDENCY_STATUSES.join(', ')}`, 400);
  }

  return residentRepo.getAreaSummary({
    buildingId,
    status: status || 'admitted',
  });
};

const listResidentsByArea = async ({
  buildingId,
  floorId,
  roomId,
  search,
  status,
  page = 1,
  limit = 20,
}) => {
  assertAreaFilter({ buildingId, floorId, roomId });

  if (status && !RESIDENCY_STATUSES.includes(status)) {
    throw new ServiceError(`status must be one of: ${RESIDENCY_STATUSES.join(', ')}`, 400);
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const result = await residentRepo.findByArea({
    buildingId,
    floorId,
    roomId,
    search,
    status: status || 'admitted',
    page: pageNum,
    limit: limitNum,
  });

  mapResolveError(result.error);

  return {
    data: result.data.map(mapResidentByAreaItem),
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: Math.ceil(result.total / result.limit) || 0,
  };
};

const getResidentDetail = async (residentId) => {
  assertResidentId(residentId);

  const resident = await residentRepo.findByIdWithDetail(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);

  return { resident: mapResidentDetail(resident) };
};

const assertObjectId = (value, label) => {
  if (!residentRepo.assertValidObjectId(value)) {
    throw new ServiceError(`Invalid ${label}`, 400);
  }
};

const mapTransferAssignment = (resident) => {
  const { room, floor, building } = mapAreaFromRoom(resident.roomId);
  return {
    room,
    floor,
    building,
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
  if (!resident) throw new ServiceError('Resident not found', 404);
  if (resident.residencyStatus !== 'admitted') {
    throw new ServiceError('Only admitted residents can be transferred', 400);
  }
  if (!resident.roomId || !resident.bedId) {
    throw new ServiceError('Resident is not currently assigned to a room/bed', 400);
  }

  const floor = await floorRepo.findById(floorId);
  if (!floor) throw new ServiceError('Floor not found', 404);

  const rooms = await roomRepo.findByFloorId(floorId);
  const roomIds = rooms.map((room) => room._id);
  const availableBeds = await bedRepo.findAvailableByRoomIds(roomIds);

  const bedsByRoomId = new Map();
  for (const bed of availableBeds) {
    const key = String(bed.roomId);
    if (!bedsByRoomId.has(key)) bedsByRoomId.set(key, []);
    bedsByRoomId.get(key).push({
      _id: bed._id,
      bedCode: bed.bedCode,
      bedType: bed.bedType,
      status: bed.status,
    });
  }

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
    .filter((room) => room.availableBeds.length > 0);

  return {
    resident: {
      _id: resident._id,
      residentCode: resident.residentCode,
      fullName: resident.fullName,
      residencyStatus: resident.residencyStatus,
    },
    currentAssignment: mapTransferAssignment(resident),
    targets,
  };
};

const transferResidentToRoom = async (residentId, { targetRoomId, targetBedId }) => {
  assertResidentId(residentId);
  assertObjectId(targetRoomId, 'targetRoomId');
  assertObjectId(targetBedId, 'targetBedId');

  const resident = await residentRepo.findByIdForTransfer(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);
  if (resident.residencyStatus !== 'admitted') {
    throw new ServiceError('Only admitted residents can be transferred', 400);
  }
  if (!resident.roomId || !resident.bedId) {
    throw new ServiceError('Resident is not currently assigned to a room/bed', 400);
  }
  if (String(resident.bedId._id) === String(targetBedId)) {
    throw new ServiceError('Resident is already assigned to this bed', 400);
  }

  const targetRoom = await roomRepo.findById(targetRoomId);
  if (!targetRoom) throw new ServiceError('Target room not found', 404);
  if (targetRoom.status === 'closed') throw new ServiceError('Target room is closed', 400);
  if (targetRoom.occupiedCount >= targetRoom.capacity) {
    throw new ServiceError('Target room is full', 400);
  }

  const targetBed = await bedRepo.findById(targetBedId);
  if (!targetBed) throw new ServiceError('Target bed not found', 404);
  if (String(targetBed.roomId) !== String(targetRoomId)) {
    throw new ServiceError('targetBedId does not belong to targetRoomId', 400);
  }
  if (targetBed.status !== 'available' || targetBed.assignedResidentId) {
    throw new ServiceError('Target bed is not available', 400);
  }

  const sameRoomAvailableBeds = await bedRepo.findAvailableByRoomIds([targetRoomId]);
  if (!sameRoomAvailableBeds.length) {
    throw new ServiceError('Target room has no available beds', 400);
  }

  const now = new Date();
  await bedRepo.releaseBed(resident.bedId._id, now);
  await roomRepo.adjustOccupiedCount(resident.roomId._id, -1);
  await bedRepo.occupyBed(targetBedId, resident._id, now);
  await roomRepo.adjustOccupiedCount(targetRoomId, 1);

  const updatedResident = await residentRepo.updateRoomAssignment(residentId, {
    roomId: targetRoomId,
    bedId: targetBedId,
  });
  if (!updatedResident) throw new ServiceError('Resident not found', 404);

  return {
    message: 'Resident transferred successfully',
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
  };
};

const parseStringList = (input) => {
  if (input === undefined || input === null) return undefined;
  if (Array.isArray(input)) {
    return [...new Set(input.map((item) => String(item).trim()).filter(Boolean))];
  }
  if (typeof input === 'string') {
    return [...new Set(input.split(',').map((item) => item.trim()).filter(Boolean))];
  }
  throw new ServiceError('allergies and chronicConditions must be an array or comma-separated string', 400);
};

const hasInitialHealthRecord = (resident) =>
  Boolean(resident?.initialHealthCondition && String(resident.initialHealthCondition).trim());

const mapInitialHealth = (resident) => ({
  bloodType: resident.bloodType,
  initialHealthCondition: resident.initialHealthCondition || '',
  hasInitialHealthRecord: hasInitialHealthRecord(resident),
  updatedAt: resident.updatedAt,
});

const assertNoPreAdmissionFieldsOnInitialHealth = (body) => {
  const forbidden = [];
  if (body.allergies !== undefined) forbidden.push('allergies');
  if (body.chronicConditions !== undefined) forbidden.push('chronicConditions');
  if (body.medicalHistory !== undefined) forbidden.push('medicalHistory');
  if (body.drugAllergies !== undefined) forbidden.push('drugAllergies');
  if (forbidden.length) {
    throw new ServiceError(
      `${forbidden.join(', ')} cannot be updated via initial-health. Use /pre-existing-conditions or /drug-allergies.`,
      400
    );
  }
};

const mapInitialHealthListItem = (resident) => {
  const { room, floor, building } = mapAreaFromRoom(resident.roomId);

  return {
    _id: resident._id,
    residentCode: resident.residentCode,
    fullName: resident.fullName,
    age: calcAge(resident.dateOfBirth),
    gender: resident.gender,
    bloodType: resident.bloodType,
    residencyStatus: resident.residencyStatus,
    hasInitialHealthRecord: hasInitialHealthRecord(resident),
    room,
    floor,
    building,
    updatedAt: resident.updatedAt,
  };
};

const listResidentsForInitialHealth = async ({
  search,
  status,
  recorded,
  page = 1,
  limit = 20,
}) => {
  if (status && !RESIDENCY_STATUSES.includes(status)) {
    throw new ServiceError(`status must be one of: ${RESIDENCY_STATUSES.join(', ')}`, 400);
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const { data, total, page: currentPage, limit: currentLimit } =
    await residentRepo.findForInitialHealthList({
      search,
      status: status || 'admitted',
      recorded,
      page: pageNum,
      limit: limitNum,
    });

  return {
    data: data.map(mapInitialHealthListItem),
    total,
    page: currentPage,
    limit: currentLimit,
    totalPages: Math.ceil(total / currentLimit) || 0,
  };
};

const hasPreExistingRecord = (resident) => {
  const c = resident.chronicConditions?.length ?? 0;
  const m = resident.medicalHistory?.length ?? 0;
  return c > 0 || m > 0;
};

const mapPreExistingListItem = (resident) => {
  const { room, floor, building } = mapAreaFromRoom(resident.roomId);
  return {
    _id: resident._id,
    residentCode: resident.residentCode,
    fullName: resident.fullName,
    age: calcAge(resident.dateOfBirth),
    gender: resident.gender,
    residencyStatus: resident.residencyStatus,
    hasPreExistingRecord: hasPreExistingRecord(resident),
    chronicConditionsCount: resident.chronicConditions?.length ?? 0,
    medicalHistoryCount: resident.medicalHistory?.length ?? 0,
    room,
    floor,
    building,
    updatedAt: resident.updatedAt,
  };
};

const listResidentsForPreExisting = async ({
  search,
  status,
  recorded,
  page = 1,
  limit = 20,
}) => {
  if (status && !RESIDENCY_STATUSES.includes(status)) {
    throw new ServiceError(`status must be one of: ${RESIDENCY_STATUSES.join(', ')}`, 400);
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const { data, total, page: currentPage, limit: currentLimit } =
    await residentRepo.findForPreExistingList({
      search,
      status: status || 'admitted',
      recorded,
      page: pageNum,
      limit: limitNum,
    });

  return {
    data: data.map(mapPreExistingListItem),
    total,
    page: currentPage,
    limit: currentLimit,
    totalPages: Math.ceil(total / currentLimit) || 0,
  };
};

const mapDrugAllergiesListItem = (resident) => {
  const { room, floor, building } = mapAreaFromRoom(resident.roomId);
  const count = resident.drugAllergies?.length ?? 0;
  return {
    _id: resident._id,
    residentCode: resident.residentCode,
    fullName: resident.fullName,
    age: calcAge(resident.dateOfBirth),
    gender: resident.gender,
    residencyStatus: resident.residencyStatus,
    hasDrugAllergiesRecord: count > 0,
    drugAllergiesCount: count,
    room,
    floor,
    building,
    updatedAt: resident.updatedAt,
  };
};

const listResidentsForDrugAllergies = async ({
  search,
  status,
  recorded,
  page = 1,
  limit = 20,
}) => {
  if (status && !RESIDENCY_STATUSES.includes(status)) {
    throw new ServiceError(`status must be one of: ${RESIDENCY_STATUSES.join(', ')}`, 400);
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const { data, total, page: currentPage, limit: currentLimit } =
    await residentRepo.findForDrugAllergiesList({
      search,
      status: status || 'admitted',
      recorded,
      page: pageNum,
      limit: limitNum,
    });

  return {
    data: data.map(mapDrugAllergiesListItem),
    total,
    page: currentPage,
    limit: currentLimit,
    totalPages: Math.ceil(total / currentLimit) || 0,
  };
};

const getInitialHealth = async (residentId) => {
  assertResidentId(residentId);

  const resident = await residentRepo.findInitialHealthByResidentId(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);

  return {
    resident: {
      _id: resident._id,
      residentCode: resident.residentCode,
      fullName: resident.fullName,
      age: calcAge(resident.dateOfBirth),
      gender: resident.gender,
      residencyStatus: resident.residencyStatus,
    },
    initialHealth: mapInitialHealth(resident),
  };
};

const recordInitialHealth = async (residentId, body) => {
  assertResidentId(residentId);
  assertNoPreAdmissionFieldsOnInitialHealth(body);

  const { bloodType, initialHealthCondition } = body;

  const description = initialHealthCondition?.trim();
  if (!description) {
    throw new ServiceError('initialHealthCondition is required', 400);
  }
  if (description.length < 10) {
    throw new ServiceError('initialHealthCondition must be at least 10 characters', 400);
  }

  const update = { initialHealthCondition: description };

  if (bloodType !== undefined) {
    if (!BLOOD_TYPES.includes(bloodType)) {
      throw new ServiceError(`bloodType must be one of: ${BLOOD_TYPES.join(', ')}`, 400);
    }
    update.bloodType = bloodType;
  }

  const existing = await residentRepo.findById(residentId);
  if (!existing) throw new ServiceError('Resident not found', 404);

  const updated = await residentRepo.updateInitialHealth(residentId, update);
  if (!updated) throw new ServiceError('Resident not found', 404);

  return {
    message: hasInitialHealthRecord(existing)
      ? 'Initial health condition updated'
      : 'Initial health condition recorded',
    initialHealth: mapInitialHealth(updated),
  };
};

const validateConditionEntries = (values, fieldName) => {
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) {
    throw new ServiceError(`${fieldName} must be an array or comma-separated string`, 400);
  }
  if (values.length > 30) {
    throw new ServiceError(`${fieldName} cannot contain more than 30 items`, 400);
  }
  values.forEach((item) => {
    if (item.length < 2) {
      throw new ServiceError(`Each ${fieldName} item must be at least 2 characters`, 400);
    }
    if (item.length > 200) {
      throw new ServiceError(`Each ${fieldName} item cannot exceed 200 characters`, 400);
    }
  });
  return values;
};

const mapPreExistingConditions = (resident) => ({
  chronicConditions: resident.chronicConditions || [],
  medicalHistory: resident.medicalHistory || [],
  updatedAt: resident.updatedAt,
});

const mapDrugAllergies = (resident) => ({
  drugAllergies: resident.drugAllergies || [],
  updatedAt: resident.updatedAt,
});

const mapResidentWithArea = (resident, extra = {}) => {
  const { room, floor, building } = mapAreaFromRoom(resident.roomId);
  return {
    _id: resident._id,
    residentCode: resident.residentCode,
    fullName: resident.fullName,
    age: calcAge(resident.dateOfBirth),
    gender: resident.gender,
    residencyStatus: resident.residencyStatus,
    room,
    floor,
    building,
    bed: resident.bedId
      ? {
          _id: resident.bedId._id,
          bedCode: resident.bedId.bedCode,
          status: resident.bedId.status,
        }
      : null,
    ...extra,
  };
};

const getPreExistingConditions = async (residentId) => {
  assertResidentId(residentId);
  const resident = await residentRepo.findPreExistingByResidentId(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);

  return {
    resident: mapResidentWithArea(resident),
    preExistingConditions: mapPreExistingConditions(resident),
  };
};

const updatePreExistingConditions = async (residentId, body) => {
  assertResidentId(residentId);
  const parsedChronic = parseStringList(body.chronicConditions);
  const parsedHistory = parseStringList(body.medicalHistory);
  const chronicConditions = validateConditionEntries(parsedChronic, 'chronicConditions');
  const medicalHistory = validateConditionEntries(parsedHistory, 'medicalHistory');

  if (chronicConditions === undefined && medicalHistory === undefined) {
    throw new ServiceError('Provide at least one of chronicConditions or medicalHistory', 400);
  }

  const update = {};
  if (chronicConditions !== undefined) update.chronicConditions = chronicConditions;
  if (medicalHistory !== undefined) update.medicalHistory = medicalHistory;

  const existing = await residentRepo.findById(residentId);
  if (!existing) throw new ServiceError('Resident not found', 404);

  const updated = await residentRepo.updatePreExistingConditions(residentId, update);
  if (!updated) throw new ServiceError('Resident not found', 404);

  return {
    message: 'Pre-existing medical conditions updated',
    preExistingConditions: mapPreExistingConditions(updated),
  };
};

const getDrugAllergies = async (residentId) => {
  assertResidentId(residentId);
  const resident = await residentRepo.findDrugAllergiesByResidentId(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);

  return {
    resident: mapResidentWithArea(resident),
    drugAllergies: mapDrugAllergies(resident),
  };
};

const updateDrugAllergies = async (residentId, body) => {
  assertResidentId(residentId);
  const parsed = parseStringList(body.drugAllergies);
  const drugAllergies = validateConditionEntries(parsed, 'drugAllergies');

  if (drugAllergies === undefined) {
    throw new ServiceError('drugAllergies is required', 400);
  }

  const existing = await residentRepo.findById(residentId);
  if (!existing) throw new ServiceError('Resident not found', 404);

  const updated = await residentRepo.updateDrugAllergies(residentId, { drugAllergies });
  if (!updated) throw new ServiceError('Resident not found', 404);

  return {
    message: 'Drug allergies updated',
    drugAllergies: mapDrugAllergies(updated),
  };
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
};

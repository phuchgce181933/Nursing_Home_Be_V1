const { Types } = require('mongoose');
const ServiceError = require('./serviceError');
const residentRepo = require('../repositories/residentRepository');
const { GENDERS, BLOOD_TYPES, RESIDENCY_STATUSES } = require('../models/enums');
const User = require('../models/user');
const { createAuditLog } = require('../utils/auditLog');

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const parseOptionalDate = (value, fieldName) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ServiceError(`${fieldName} is invalid`, 400);
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
  if (!Array.isArray(value)) {
    throw new ServiceError('emergencyContacts must be an array', 400);
  }

  return value.map((contact, index) => {
    if (!contact || typeof contact !== 'object') {
      throw new ServiceError(`emergencyContacts[${index}] must be an object`, 400);
    }

    const fullName = String(contact.fullName || '').trim();
    const relationship = String(contact.relationship || '').trim();
    const phone = String(contact.phone || '').trim();

    if (!fullName || !relationship || !phone) {
      throw new ServiceError(`emergencyContacts[${index}] must include fullName, relationship, and phone`, 400);
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
  if (invalidIds.length) {
    throw new ServiceError(`Invalid familyPortalAccountIds: ${invalidIds.join(', ')}`, 400);
  }

  const users = await User.find({ _id: { $in: uniqueIds }, role: 'family' }).select('_id');
  if (users.length !== uniqueIds.length) {
    throw new ServiceError('Some familyPortalAccountIds were not found or are not family accounts', 400);
  }

  return uniqueIds;
};

const generateResidentCode = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `RES${Date.now().toString(36).toUpperCase()}${Math.random()
      .toString(36)
      .slice(2, 5)
      .toUpperCase()}`;
    const exists = await residentRepo.findByResidentCode(code);
    if (!exists) return code;
  }
  throw new ServiceError('Unable to generate residentCode', 500);
};

const formatResident = (residentDoc) => {
  const resident = residentDoc?.toObject ? residentDoc.toObject() : residentDoc;
  if (!resident) return null;

  return {
    _id: resident._id,
    residentCode: resident.residentCode,
    fullName: resident.fullName,
    dateOfBirth: resident.dateOfBirth,
    gender: resident.gender,
    citizenId: resident.citizenId,
    insuranceNumber: resident.insuranceNumber,
    bloodType: resident.bloodType,
    personalAddress: resident.personalAddress,
    emergencyContacts: resident.emergencyContacts || [],
    allergies: resident.allergies || [],
    chronicConditions: resident.chronicConditions || [],
    initialHealthCondition: resident.initialHealthCondition,
    residencyStatus: resident.residencyStatus,
    admittedAt: resident.admittedAt,
    dischargedAt: resident.dischargedAt,
    servicePackage: resident.servicePackage,
    room: resident.roomId
      ? { _id: resident.roomId._id || resident.roomId, roomCode: resident.roomId.roomCode, name: resident.roomId.name }
      : null,
    bed: resident.bedId
      ? { _id: resident.bedId._id || resident.bedId, bedCode: resident.bedId.bedCode }
      : null,
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

const adminCreateResident = async (user, body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    throw new ServiceError(
      'Request body is empty or not parsed. Use POST with Header Content-Type: application/json and Body type raw -> JSON.',
      400
    );
  }

  const fullName = body.fullName ? String(body.fullName).trim() : '';
  if (!fullName) throw new ServiceError('fullName is required', 400);

  const residentCode = body.residentCode ? String(body.residentCode).trim() : null;
  if (residentCode) {
    const existing = await residentRepo.findByResidentCode(residentCode);
    if (existing) throw new ServiceError('residentCode already exists', 409);
  }

  if (body.gender && !GENDERS.includes(body.gender)) {
    throw new ServiceError(`gender must be one of: ${GENDERS.join(', ')}`, 400);
  }
  if (body.bloodType && !BLOOD_TYPES.includes(body.bloodType)) {
    throw new ServiceError(`bloodType must be one of: ${BLOOD_TYPES.join(', ')}`, 400);
  }
  if (body.residencyStatus && !RESIDENCY_STATUSES.includes(body.residencyStatus)) {
    throw new ServiceError(`residencyStatus must be one of: ${RESIDENCY_STATUSES.join(', ')}`, 400);
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
  return { message: 'Resident profile created', resident: formatResident(populated) };
};

const adminListResidents = async (query) => {
  const filter = {};

  if (query.residencyStatus) {
    if (!RESIDENCY_STATUSES.includes(query.residencyStatus)) {
      throw new ServiceError(`residencyStatus must be one of: ${RESIDENCY_STATUSES.join(', ')}`, 400);
    }
    filter.residencyStatus = query.residencyStatus;
  }

  if (query.gender) {
    if (!GENDERS.includes(query.gender)) {
      throw new ServiceError(`gender must be one of: ${GENDERS.join(', ')}`, 400);
    }
    filter.gender = query.gender;
  }

  if (query.bloodType) {
    if (!BLOOD_TYPES.includes(query.bloodType)) {
      throw new ServiceError(`bloodType must be one of: ${BLOOD_TYPES.join(', ')}`, 400);
    }
    filter.bloodType = query.bloodType;
  }

  if (query.roomId) filter.roomId = query.roomId;
  if (query.bedId) filter.bedId = query.bedId;

  if (query.admittedFrom || query.admittedTo) {
    filter.admittedAt = {};
    if (query.admittedFrom) {
      const from = parseOptionalDate(query.admittedFrom, 'admittedFrom');
      filter.admittedAt.$gte = from;
    }
    if (query.admittedTo) {
      const to = parseOptionalDate(query.admittedTo, 'admittedTo');
      filter.admittedAt.$lte = to;
    }
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
  const sort = { createdAt: -1 };

  const [data, total] = await Promise.all([
    residentRepo.findAll(filter, { sort, skip, limit: limitNum }),
    residentRepo.countAll(filter),
  ]);

  return {
    data: data.map(formatResident),
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  };
};

const adminGetResident = async (residentId) => {
  const resident = await residentRepo.findByIdForAdmin(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);
  return { resident: formatResident(resident) };
};

const adminUpdatePersonalInfo = async (user, residentId, body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    throw new ServiceError('Request body is empty', 400);
  }

  const update = {};

  if (body.fullName !== undefined) {
    const fullName = String(body.fullName).trim();
    if (!fullName) throw new ServiceError('fullName cannot be empty', 400);
    update.fullName = fullName;
  }

  if (body.dateOfBirth !== undefined) {
    update.dateOfBirth = parseOptionalDate(body.dateOfBirth, 'dateOfBirth');
  }

  if (body.gender !== undefined) {
    if (!GENDERS.includes(body.gender)) {
      throw new ServiceError(`gender must be one of: ${GENDERS.join(', ')}`, 400);
    }
    update.gender = body.gender;
  }

  if (body.citizenId !== undefined) update.citizenId = String(body.citizenId || '').trim() || undefined;
  if (body.insuranceNumber !== undefined) update.insuranceNumber = String(body.insuranceNumber || '').trim() || undefined;

  if (body.bloodType !== undefined) {
    if (!BLOOD_TYPES.includes(body.bloodType)) {
      throw new ServiceError(`bloodType must be one of: ${BLOOD_TYPES.join(', ')}`, 400);
    }
    update.bloodType = body.bloodType;
  }

  if (body.personalAddress !== undefined) {
    update.personalAddress = String(body.personalAddress || '').trim() || undefined;
  }

  const allergies = normalizeStringArray(body.allergies);
  if (allergies !== undefined) update.allergies = allergies;

  const chronicConditions = normalizeStringArray(body.chronicConditions);
  if (chronicConditions !== undefined) update.chronicConditions = chronicConditions;

  if (body.initialHealthCondition !== undefined) {
    update.initialHealthCondition = String(body.initialHealthCondition || '').trim() || undefined;
  }

  if (Object.keys(update).length === 0) {
    throw new ServiceError('No valid personal info fields provided', 400);
  }

  const before = await residentRepo.findByIdForAdmin(residentId);
  if (!before) throw new ServiceError('Resident not found', 404);

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

  return { message: 'Resident personal info updated', resident: formatResident(updated) };
};

const adminUpdateFamilyInfo = async (user, residentId, body, req) => {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    throw new ServiceError('Request body is empty', 400);
  }

  const update = {};

  const emergencyContacts = normalizeEmergencyContacts(body.emergencyContacts);
  if (emergencyContacts !== undefined) update.emergencyContacts = emergencyContacts;

  const familyPortalAccountIds = await normalizeFamilyAccountIds(body.familyPortalAccountIds);
  if (familyPortalAccountIds !== undefined) update.familyPortalAccountIds = familyPortalAccountIds;

  if (Object.keys(update).length === 0) {
    throw new ServiceError('No valid family info fields provided', 400);
  }

  const before = await residentRepo.findByIdForAdmin(residentId);
  if (!before) throw new ServiceError('Resident not found', 404);

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

  return { message: 'Resident family info updated', resident: formatResident(updated) };
};

module.exports = {
  adminCreateResident,
  adminListResidents,
  adminGetResident,
  adminUpdatePersonalInfo,
  adminUpdateFamilyInfo,
};

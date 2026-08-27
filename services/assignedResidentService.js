const mongoose = require('mongoose');
const { apiErr, apiSuccess, CODES, SUCCESS } = require('../utils/apiError');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const residentRepo = require('../repositories/residentRepository');
const activityService = require('./activityService');

const MINIMAL_SELECT = '_id fullName residentCode';
const MEAL_RESIDENT_SELECT = '_id fullName residentCode allergies chronicConditions';
const FULL_SELECT =
  'residentCode fullName dateOfBirth gender bloodType allergies drugAllergies chronicConditions initialHealthCondition admittedAt residencyStatus roomId bedId';

const POPULATE = [
  {
    path: 'roomId',
    select: 'roomNumber roomType floorId buildingId',
    populate: [
      {
        path: 'floorId',
        select: 'name floorNumber buildingId',
        populate: { path: 'buildingId', select: 'name code' },
      },
      { path: 'buildingId', select: 'name code' },
    ],
  },
  { path: 'bedId', select: 'bedCode bedType status' },
];

const emptyAssignedResidents = () => ({
  data: [],
  total: 0,
  ...apiSuccess(SUCCESS.CAREGIVER_NO_ASSIGNED_RESIDENTS),
});

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

const mapAreaFromRoom = (room, bed) => {
  if (!room) {
    return { room: null, floor: null, building: null, bed: bed || null };
  }
  const floor = room.floorId;
  const building = floor?.buildingId || room.buildingId;
  const floorName =
    floor?.name || (floor?.floorNumber != null ? `Tầng ${floor.floorNumber}` : null);
  const buildingName = building?.name || building?.code;

  return {
    room: {
      _id: room._id,
      roomNumber: room.roomNumber,
      label: room.roomNumber != null ? `Phòng ${room.roomNumber}` : null,
    },
    floor: floor
      ? {
          _id: floor._id,
          name: floor.name,
          floorNumber: floor.floorNumber,
          label: buildingName && floorName ? `${floorName} · ${buildingName}` : floorName,
        }
      : null,
    building: building ? { _id: building._id, code: building.code, name: building.name } : null,
    bed: bed
      ? {
          _id: bed._id,
          bedCode: bed.bedCode,
          bedType: bed.bedType,
        }
      : null,
  };
};

const formatResident = (resident, minimal) => {
  if (minimal) {
    return {
      _id: resident._id,
      fullName: resident.fullName,
      residentCode: resident.residentCode,
    };
  }

  const area = mapAreaFromRoom(resident.roomId, resident.bedId);
  return {
    _id: resident._id,
    residentCode: resident.residentCode,
    fullName: resident.fullName,
    dateOfBirth: resident.dateOfBirth,
    age: calcAge(resident.dateOfBirth),
    gender: resident.gender,
    bloodType: resident.bloodType,
    allergies: resident.allergies || [],
    drugAllergies: resident.drugAllergies || [],
    chronicConditions: resident.chronicConditions || [],
    initialHealthCondition: resident.initialHealthCondition,
    admittedAt: resident.admittedAt,
    residencyStatus: resident.residencyStatus,
    room: area.room,
    floor: area.floor,
    building: area.building,
    bed: area.bed,
  };
};

const getStaffProfileByUserId = async (userId) => {
  const profile = await staffProfileRepo.findByUserId(userId);
  if (!profile) {
    throw apiErr(CODES.CAREGIVER_STAFF_PROFILE_NOT_FOUND, { statusCode: 404 });
  }
  return profile;
};

const listAssignedResidentsForUser = async (userId, options = {}) => {
  const { fields = 'full', search } = options;
  const profile = await getStaffProfileByUserId(userId);
  const ids = (profile.assignedResidentIds || []).map((r) => r._id || r);

  if (!ids.length) {
    return emptyAssignedResidents();
  }

  const filter = { _id: { $in: ids }, residencyStatus: 'admitted' };
  const searchTrim = String(search || '').trim();
  if (searchTrim) {
    const re = new RegExp(searchTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ fullName: re }, { residentCode: re }];
  }

  const minimal = fields === 'minimal';
  const rows = await residentRepo.findByFilterLean(filter, {
    select: minimal ? MINIMAL_SELECT : FULL_SELECT,
    populate: minimal ? undefined : POPULATE,
    sort: { fullName: 1 },
  });
  const data = rows.map((r) => formatResident(r, minimal));
  const result = { data, total: data.length };
  if (!data.length) {
    Object.assign(result, apiSuccess(SUCCESS.CAREGIVER_NO_ASSIGNED_RESIDENTS));
  }
  return result;
};

const assertValidObjectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
    throw apiErr(CODES.CAREGIVER_INVALID_OBJECT_ID, { statusCode: 400, params: { label } });
  }
};

const buildAdmittedAssignedFilter = (assignedIds, search) => {
  const filter = { _id: { $in: assignedIds }, residencyStatus: 'admitted' };
  const searchTrim = String(search || '').trim();
  if (searchTrim) {
    const re = new RegExp(searchTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ fullName: re }, { residentCode: re }];
  }
  return filter;
};

const listAssignedAdmittedResidentsForUser = async (userId, options = {}) => {
  const { search, select = MEAL_RESIDENT_SELECT } = options;
  const profile = await getStaffProfileByUserId(userId);
  const ids = (profile.assignedResidentIds || []).map((r) => r._id || r);

  if (!ids.length) {
    return { data: [], total: 0 };
  }

  const rows = await residentRepo.findByFilterLean(buildAdmittedAssignedFilter(ids, search), {
    select,
    sort: { fullName: 1 },
  });

  return { data: rows, total: rows.length };
};

const listAssignedResidentActivities = async (userId, options = {}) => {
  const profile = await getStaffProfileByUserId(userId);
  const ids = (profile.assignedResidentIds || []).map((r) => r._id || r);

  if (!ids.length) {
    return { data: [], total: 0 };
  }

  const now = new Date();
  const from = options.from ? new Date(options.from) : now;
  const to = options.to ? new Date(options.to) : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const query = {
    participantResidentIds: ids,
    status: options.status || 'scheduled',
    from,
    to,
    page: options.page || 1,
    limit: options.limit || 20,
  };

  return activityService.listActivities(query);
};

const listAssignedAdmittedResidentsForStaffProfile = async (staffProfileId, options = {}) => {
  assertValidObjectId(staffProfileId, 'staffProfileId');
  const profile = await staffProfileRepo.findById(staffProfileId);
  if (!profile) {
    throw apiErr(CODES.STAFF_PROFILE_NOT_FOUND, { statusCode: 404 });
  }

  const ids = (profile.assignedResidentIds || []).map((r) => r._id || r);
  if (!ids.length) {
    return { data: [], total: 0 };
  }

  const { search, select = MINIMAL_SELECT } = options;
  const rows = await residentRepo.findByFilterLean(buildAdmittedAssignedFilter(ids, search), {
    select,
    sort: { fullName: 1 },
  });

  return { data: rows, total: rows.length };
};

const getAssignedResidentIdSetForUser = async (userId) => {
  const profile = await getStaffProfileByUserId(userId);
  return new Set((profile.assignedResidentIds || []).map((r) => String(r._id || r)));
};

const assertResidentsAssignedToUser = async (userId, residentIds) => {
  const ids = [...new Set((residentIds || []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return;

  const assigned = await getAssignedResidentIdSetForUser(userId);
  const outside = ids.filter((id) => !assigned.has(id));
  if (outside.length) {
    throw apiErr(CODES.CAREGIVER_RESIDENT_NOT_ASSIGNED, { statusCode: 403 });
  }
};

const assertResidentAssignedToStaffProfile = async (staffProfileId, residentId) => {
  assertValidObjectId(staffProfileId, 'staffProfileId');
  assertValidObjectId(residentId, 'residentId');

  const profile = await staffProfileRepo.findById(staffProfileId);
  if (!profile) {
    throw apiErr(CODES.STAFF_PROFILE_NOT_FOUND, { statusCode: 404 });
  }

  const assigned = (profile.assignedResidentIds || []).map((r) => String(r._id || r));
  if (!assigned.includes(String(residentId))) {
    throw apiErr(CODES.CAREGIVER_RESIDENT_NOT_ASSIGNED_FOR_STAFF, { statusCode: 400 });
  }
};

const getAssignedResidentById = async (userId, residentId) => {
  assertValidObjectId(residentId, 'residentId');
  const profile = await getStaffProfileByUserId(userId);
  const assigned = (profile.assignedResidentIds || []).map((r) => String(r._id || r));
  if (!assigned.includes(String(residentId))) {
    throw apiErr(CODES.CAREGIVER_RESIDENT_NOT_ASSIGNED, { statusCode: 403 });
  }

  const resident = await residentRepo.findOneByFilterLean(
    { _id: residentId, residencyStatus: 'admitted' },
    { select: FULL_SELECT, populate: POPULATE }
  );

  if (!resident) {
    throw apiErr(CODES.CAREGIVER_RESIDENT_NOT_ADMITTED, { statusCode: 404 });
  }

  return formatResident(resident, false);
};

module.exports = {
  MEAL_RESIDENT_SELECT,
  getStaffProfileByUserId,
  listAssignedResidentsForUser,
  listAssignedResidentActivities,
  listAssignedAdmittedResidentsForUser,
  listAssignedAdmittedResidentsForStaffProfile,
  assertResidentsAssignedToUser,
  assertResidentAssignedToStaffProfile,
  getAssignedResidentIdSetForUser,
  getAssignedResidentById,
};

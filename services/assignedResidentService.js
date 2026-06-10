const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const Resident = require('../models/resident');

const EMPTY_MSG = 'Chưa được phân công cư dân. Liên hệ quản lý.';

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
    throw new ServiceError('Không tìm thấy hồ sơ nhân viên. Vui lòng liên hệ quản trị.', 404);
  }
  return profile;
};

const listAssignedResidentsForUser = async (userId, options = {}) => {
  const { fields = 'full', search } = options;
  const profile = await getStaffProfileByUserId(userId);
  const ids = (profile.assignedResidentIds || []).map((r) => r._id || r);

  if (!ids.length) {
    return { data: [], total: 0, message: EMPTY_MSG };
  }

  const filter = { _id: { $in: ids }, residencyStatus: 'admitted' };
  const searchTrim = String(search || '').trim();
  if (searchTrim) {
    const re = new RegExp(searchTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ fullName: re }, { residentCode: re }];
  }

  const minimal = fields === 'minimal';
  let query = Resident.find(filter);
  if (minimal) {
    query = query.select(MINIMAL_SELECT);
  } else {
    query = query.select(FULL_SELECT).populate(POPULATE);
  }

  const rows = await query.sort({ fullName: 1 }).lean();
  const data = rows.map((r) => formatResident(r, minimal));
  const result = { data, total: data.length };
  if (!data.length) {
    result.message = EMPTY_MSG;
  }
  return result;
};

const assertValidObjectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
    throw new ServiceError(`${label} không hợp lệ`, 400);
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
    return { data: [], total: 0, message: EMPTY_MSG };
  }

  const rows = await Resident.find(buildAdmittedAssignedFilter(ids, search))
    .select(select)
    .sort({ fullName: 1 })
    .lean();

  return { data: rows, total: rows.length };
};

const listAssignedAdmittedResidentsForStaffProfile = async (staffProfileId, options = {}) => {
  assertValidObjectId(staffProfileId, 'staffProfileId');
  const profile = await staffProfileRepo.findById(staffProfileId);
  if (!profile) {
    throw new ServiceError('Không tìm thấy hồ sơ nhân viên', 404);
  }

  const ids = (profile.assignedResidentIds || []).map((r) => r._id || r);
  if (!ids.length) {
    return { data: [], total: 0 };
  }

  const { search, select = MINIMAL_SELECT } = options;
  const rows = await Resident.find(buildAdmittedAssignedFilter(ids, search))
    .select(select)
    .sort({ fullName: 1 })
    .lean();

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
    throw new ServiceError('Cư dân không thuộc danh sách phụ trách của bạn', 403);
  }
};

const assertResidentAssignedToStaffProfile = async (staffProfileId, residentId) => {
  assertValidObjectId(staffProfileId, 'staffProfileId');
  assertValidObjectId(residentId, 'residentId');

  const profile = await staffProfileRepo.findById(staffProfileId);
  if (!profile) {
    throw new ServiceError('Không tìm thấy hồ sơ nhân viên', 404);
  }

  const assigned = (profile.assignedResidentIds || []).map((r) => String(r._id || r));
  if (!assigned.includes(String(residentId))) {
    throw new ServiceError('Cư dân không thuộc danh sách phụ trách của nhân viên được chọn', 400);
  }
};

const getAssignedResidentById = async (userId, residentId) => {
  assertValidObjectId(residentId, 'residentId');
  const profile = await getStaffProfileByUserId(userId);
  const assigned = (profile.assignedResidentIds || []).map((r) => String(r._id || r));
  if (!assigned.includes(String(residentId))) {
    throw new ServiceError('Cư dân không thuộc danh sách phụ trách của bạn', 403);
  }

  const resident = await Resident.findOne({ _id: residentId, residencyStatus: 'admitted' })
    .select(FULL_SELECT)
    .populate(POPULATE)
    .lean();

  if (!resident) {
    throw new ServiceError('Cư dân không tồn tại hoặc không ở trạng thái đang ở viện', 404);
  }

  return formatResident(resident, false);
};

module.exports = {
  MEAL_RESIDENT_SELECT,
  getStaffProfileByUserId,
  listAssignedResidentsForUser,
  listAssignedAdmittedResidentsForUser,
  listAssignedAdmittedResidentsForStaffProfile,
  assertResidentsAssignedToUser,
  assertResidentAssignedToStaffProfile,
  getAssignedResidentIdSetForUser,
  getAssignedResidentById,
};

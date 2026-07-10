const mongoose = require('mongoose');
const Resident = require('../models/resident');

const findForAssignment = async ({
  floorId,
  floorIds,
  roomId,
  roomIds,
  search,
  status = 'admitted',
  limit = 200,
  residentIds,
} = {}) => {
  const filter = {};
  if (status) filter.residencyStatus = Array.isArray(status) ? { $in: status } : status;

  if (residentIds) {
    filter._id = { $in: residentIds };
  }

  const Room = require('../models/room');

  if (roomIds?.length) {
    filter.roomId = { $in: roomIds };
  } else if (roomId) {
    filter.roomId = roomId;
  } else if (floorIds?.length) {
    const rooms = await Room.find({ floorId: { $in: floorIds } }).select('_id');
    filter.roomId = { $in: rooms.map((r) => r._id) };
  } else if (floorId) {
    const rooms = await Room.find({ floorId }).select('_id');
    filter.roomId = { $in: rooms.map((r) => r._id) };
  }

  if (search) {
    const s = search.trim();
    filter.$or = [
      { fullName: { $regex: s, $options: 'i' } },
      { residentCode: { $regex: s, $options: 'i' } },
    ];
  }

  return Resident.find(filter)
    .select('residentCode fullName roomId residencyStatus dateOfBirth gender bloodType avatarUrl')
    .populate({ path: 'roomId', select: 'roomNumber floorId roomType' })
    .sort({ fullName: 1 })
    .limit(Math.min(limit, 500))
    .lean();
};

const buildSearchFilter = (search, status) => {
  const filter = {};
  if (status) filter.residencyStatus = Array.isArray(status) ? { $in: status } : status;
  if (search) {
    const s = search.trim();
    filter.$or = [
      { fullName: { $regex: s, $options: 'i' } },
      { residentCode: { $regex: s, $options: 'i' } },
    ];
  }
  return filter;
};

const findForFamilyManagement = async ({
  search,
  status = 'admitted',
  page = 1,
  limit = 20,
} = {}) => {
  const filter = buildSearchFilter(search, status);
  const skip = (page - 1) * limit;
  const limitNum = Math.min(100, Math.max(1, limit));

  const [data, total] = await Promise.all([
    Resident.find(filter)
      .select('residentCode fullName roomId residencyStatus emergencyContacts avatarUrl')
      .populate({
        path: 'roomId',
        select: 'roomNumber floorId roomType',
        populate: { path: 'floorId', select: 'name floorNumber' },
      })
      .sort({ fullName: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Resident.countDocuments(filter),
  ]);

  return { data, total, page, limit: limitNum };
};

const findByIdWithFamily = async (residentId) =>
  Resident.findById(residentId)
    .populate({
      path: 'roomId',
      select: 'roomNumber floorId roomType',
      populate: { path: 'floorId', select: 'name floorNumber' },
    })
    .lean();

const findById = async (id) => Resident.findById(id);

const findByResidentCode = async (residentCode) =>
  Resident.findOne({ residentCode: residentCode.toUpperCase().trim() });

const createResident = async (data) => Resident.create(data);

const findAll = async (filter, { sort, skip, limit }) =>
  Resident.find(filter)
    .select(
      'residentCode fullName dateOfBirth gender bloodType residencyStatus admittedAt roomId bedId familyPortalAccountIds avatarUrl'
    )
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate({
      path: 'roomId',
      select: 'roomCode roomNumber name roomType floorId buildingId',
      populate: {
        path: 'floorId',
        select: 'name floorNumber buildingId',
      },
    })
    .populate('bedId', 'bedCode')
    .populate('familyPortalAccountIds', 'fullName email phone');

const countAll = async (filter) => Resident.countDocuments(filter);

const findByIdForAdmin = async (id) =>
  Resident.findById(id)
    .populate('roomId', 'roomCode name')
    .populate('bedId', 'bedCode')
    .populate('familyPortalAccountIds', 'fullName email phone');

const updateById = async (id, update) =>
  Resident.findByIdAndUpdate(id, update, { new: true, runValidators: true })
    .populate('roomId', 'roomCode name')
    .populate('bedId', 'bedCode')
    .populate('familyPortalAccountIds', 'fullName email phone');

const addEmergencyContact = async (residentId, contact) => {
  const resident = await Resident.findById(residentId);
  if (!resident) return null;

  if (contact.isPrimary) {
    resident.emergencyContacts.forEach((c) => {
      c.isPrimary = false;
    });
  }

  resident.emergencyContacts.push(contact);
  await resident.save();
  return resident;
};

const replaceEmergencyContacts = async (residentId, contacts) => {
  const resident = await Resident.findByIdAndUpdate(
    residentId,
    { emergencyContacts: contacts },
    { new: true, runValidators: true }
  )
    .populate({
      path: 'roomId',
      select: 'roomNumber floorId roomType',
      populate: { path: 'floorId', select: 'name floorNumber' },
    })
    .lean();

  return resident;
};

const updateEmergencyContact = async (residentId, contactId, patch) => {
  const resident = await Resident.findById(residentId);
  if (!resident) return null;

  const contact = resident.emergencyContacts.id(contactId);
  if (!contact) return null;

  if (patch.isPrimary) {
    resident.emergencyContacts.forEach((c) => {
      c.isPrimary = false;
    });
  }

  if (patch.fullName !== undefined) contact.fullName = patch.fullName;
  if (patch.relationship !== undefined) contact.relationship = patch.relationship;
  if (patch.phone !== undefined) contact.phone = patch.phone;
  if (patch.email !== undefined) contact.email = patch.email;
  if (patch.address !== undefined) contact.address = patch.address;
  if (patch.isPrimary !== undefined) contact.isPrimary = patch.isPrimary;

  await resident.save();
  return resident;
};

const removeEmergencyContact = async (residentId, contactId) => {
  const resident = await Resident.findById(residentId);
  if (!resident) return null;

  const contact = resident.emergencyContacts.id(contactId);
  if (!contact) return null;

  contact.deleteOne();
  await resident.save();
  return resident;
};

const assertValidObjectId = (id, label = 'id') => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return false;
  }
  return true;
};

const ROOM_POPULATE = {
  path: 'roomId',
  select: 'roomNumber roomType floorId buildingId',
  populate: [
    {
      path: 'floorId',
      select: 'name floorNumber buildingId',
      populate: { path: 'buildingId', select: 'code name' },
    },
    { path: 'buildingId', select: 'code name' },
  ],
};

const resolveRoomIds = async ({ buildingId, floorId, roomId } = {}) => {
  const Room = require('../models/room');
  const Floor = require('../models/floor');

  if (roomId) {
    const room = await Room.findById(roomId).select('_id floorId buildingId roomNumber').lean();
    if (!room) return { roomIds: [], rooms: [], error: 'room_not_found' };
    if (floorId && String(room.floorId) !== String(floorId)) {
      return { roomIds: [], rooms: [], error: 'room_floor_mismatch' };
    }
    if (buildingId && String(room.buildingId) !== String(buildingId)) {
      return { roomIds: [], rooms: [], error: 'room_building_mismatch' };
    }
    return { roomIds: [room._id], rooms: [room] };
  }

  if (floorId) {
    const floor = await Floor.findById(floorId).select('_id buildingId').lean();
    if (!floor) return { roomIds: [], rooms: [], error: 'floor_not_found' };
    if (buildingId && String(floor.buildingId) !== String(buildingId)) {
      return { roomIds: [], rooms: [], error: 'floor_building_mismatch' };
    }
    const rooms = await Room.find({ floorId, status: { $nin: ['closed'] } })
      .select('_id roomNumber floorId buildingId')
      .lean();
    return { roomIds: rooms.map((r) => r._id), rooms };
  }

  if (buildingId) {
    const floors = await Floor.find({ buildingId, isActive: { $ne: false } }).select('_id').lean();
    const floorIds = floors.map((f) => f._id);
    if (!floorIds.length) return { roomIds: [], rooms: [] };
    const rooms = await Room.find({ floorId: { $in: floorIds }, status: { $nin: ['closed'] } })
      .select('_id roomNumber floorId buildingId')
      .lean();
    return { roomIds: rooms.map((r) => r._id), rooms };
  }

  return { roomIds: [], rooms: [] };
};

const getAreaSummary = async ({ buildingId, status = 'admitted' } = {}) => {
  const Room = require('../models/room');
  const floorRepo = require('./floorRepository');

  const floorFilter = { isActive: { $ne: false } };
  if (buildingId) floorFilter.buildingId = buildingId;

  const floors = await floorRepo.findAll(floorFilter);
  const floorIds = floors.map((f) => f._id);

  const rooms = floorIds.length
    ? await Room.find({ floorId: { $in: floorIds }, status: { $nin: ['closed'] } })
        .select('_id roomNumber floorId')
        .sort({ roomNumber: 1 })
        .lean()
    : [];

  const roomIds = rooms.map((r) => r._id);
  const residentFilter = { roomId: { $in: roomIds } };
  if (status) residentFilter.residencyStatus = status;

  const residents = roomIds.length
    ? await Resident.find(residentFilter).select('roomId').lean()
    : [];

  const countByRoomId = {};
  for (const r of residents) {
    const key = String(r.roomId);
    countByRoomId[key] = (countByRoomId[key] || 0) + 1;
  }

  const roomsByFloor = new Map();
  for (const room of rooms) {
    const fid = String(room.floorId);
    if (!roomsByFloor.has(fid)) roomsByFloor.set(fid, []);
    roomsByFloor.get(fid).push({
      _id: room._id,
      roomNumber: room.roomNumber,
      label: `Phong ${room.roomNumber}`,
      residentCount: countByRoomId[String(room._id)] || 0,
    });
  }

  let totalResidents = 0;
  const floorSummaries = floors.map((floor) => {
    const floorRooms = roomsByFloor.get(String(floor._id)) || [];
    const residentCount = floorRooms.reduce((sum, rm) => sum + rm.residentCount, 0);
    totalResidents += residentCount;
    const floorName = floor.name || `Tang ${floor.floorNumber}`;
    const buildingName = floor.buildingId?.name || floor.buildingId?.code;
    return {
      _id: floor._id,
      floorNumber: floor.floorNumber,
      name: floor.name,
      label: buildingName ? `${floorName} - ${buildingName}` : floorName,
      buildingId: floor.buildingId?._id || floor.buildingId,
      building: floor.buildingId
        ? {
            _id: floor.buildingId._id,
            code: floor.buildingId.code,
            name: floor.buildingId.name,
          }
        : null,
      residentCount,
      rooms: floorRooms,
    };
  });

  return { totalResidents, floors: floorSummaries };
};

const findByArea = async ({
  buildingId,
  floorId,
  roomId,
  search,
  status = 'admitted',
  page = 1,
  limit = 20,
} = {}) => {
  const { roomIds, error } = await resolveRoomIds({ buildingId, floorId, roomId });
  if (error) return { data: [], total: 0, page, limit, error };

  if (!roomIds.length) {
    return { data: [], total: 0, page, limit: Math.min(100, Math.max(1, limit)) };
  }

  const filter = { roomId: { $in: roomIds } };
  if (status) filter.residencyStatus = status;
  if (search) {
    const s = search.trim();
    filter.$or = [
      { fullName: { $regex: s, $options: 'i' } },
      { residentCode: { $regex: s, $options: 'i' } },
    ];
  }

  const skip = (page - 1) * limit;
  const limitNum = Math.min(100, Math.max(1, limit));

  const [data, total] = await Promise.all([
    Resident.find(filter)
      .select(
        'residentCode fullName dateOfBirth gender bloodType residencyStatus admittedAt chronicConditions drugAllergies roomId bedId'
      )
      .populate(ROOM_POPULATE)
      .populate({ path: 'bedId', select: 'bedCode status' })
      .sort({ fullName: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Resident.countDocuments(filter),
  ]);

  return { data, total, page, limit: limitNum };
};

const findByIdWithDetail = async (residentId) =>
  Resident.findById(residentId)
    .populate(ROOM_POPULATE)
    .populate({ path: 'bedId', select: 'bedCode status bedType' })
    .lean();

const findByIdForTransfer = async (residentId) =>
  Resident.findById(residentId)
    .select('residentCode fullName residencyStatus admittedAt roomId bedId')
    .populate(ROOM_POPULATE)
    .populate({ path: 'bedId', select: 'roomId bedCode status bedType assignedResidentId' })
    .lean();

const updateRoomAssignment = async (residentId, { roomId, bedId }) =>
  Resident.findByIdAndUpdate(
    residentId,
    {
      roomId,
      bedId,
      residencyStatus: 'admitted',
    },
    { new: true, runValidators: true }
  )
    .select('residentCode fullName residencyStatus roomId bedId admittedAt')
    .populate(ROOM_POPULATE)
    .populate({ path: 'bedId', select: 'roomId bedCode status bedType assignedResidentId' })
    .lean();

const findForInitialHealthList = async ({
  search,
  status = 'admitted',
  recorded,
  page = 1,
  limit = 20,
} = {}) => {
  const filter = {};
  if (status) filter.residencyStatus = status;

  const and = [];
  if (search) {
    const s = search.trim();
    and.push({
      $or: [
        { fullName: { $regex: s, $options: 'i' } },
        { residentCode: { $regex: s, $options: 'i' } },
      ],
    });
  }

  const recordedNorm =
    recorded === true || recorded === 'true'
      ? true
      : recorded === false || recorded === 'false'
        ? false
        : null;

  if (recordedNorm === true) {
    and.push({ initialHealthCondition: { $exists: true, $ne: '', $regex: /\S/ } });
  } else if (recordedNorm === false) {
    and.push({
      $or: [
        { initialHealthCondition: { $exists: false } },
        { initialHealthCondition: null },
        { initialHealthCondition: '' },
        { initialHealthCondition: /^\s*$/ },
      ],
    });
  }

  if (and.length) filter.$and = and;

  const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const [data, total] = await Promise.all([
    Resident.find(filter)
      .select(
        'residentCode fullName dateOfBirth gender bloodType initialHealthCondition residencyStatus roomId updatedAt'
      )
      .populate(ROOM_POPULATE)
      .sort({ fullName: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Resident.countDocuments(filter),
  ]);

  return {
    data,
    total,
    page: Math.max(1, parseInt(page, 10) || 1),
    limit: limitNum,
  };
};

const preExistingRecordedExpr = () => ({
  $gt: [
    {
      $add: [
        { $size: { $ifNull: ['$chronicConditions', []] } },
        { $size: { $ifNull: ['$medicalHistory', []] } },
      ],
    },
    0,
  ],
});

const findForPreExistingList = async ({
  search,
  status = 'admitted',
  recorded,
  page = 1,
  limit = 20,
} = {}) => {
  const filter = {};
  if (status) filter.residencyStatus = status;

  const and = [];
  if (search) {
    const s = search.trim();
    and.push({
      $or: [
        { fullName: { $regex: s, $options: 'i' } },
        { residentCode: { $regex: s, $options: 'i' } },
      ],
    });
  }

  const recordedNorm =
    recorded === true || recorded === 'true'
      ? true
      : recorded === false || recorded === 'false'
        ? false
        : null;

  if (recordedNorm === true) {
    and.push({ $expr: preExistingRecordedExpr() });
  } else if (recordedNorm === false) {
    and.push({ $expr: { $not: [preExistingRecordedExpr()] } });
  }

  if (and.length) filter.$and = and;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [data, total] = await Promise.all([
    Resident.find(filter)
      .select(
        'residentCode fullName dateOfBirth gender residencyStatus chronicConditions medicalHistory roomId updatedAt'
      )
      .populate(ROOM_POPULATE)
      .sort({ fullName: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Resident.countDocuments(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum };
};

const drugAllergiesRecordedExpr = () => ({
  $gt: [{ $size: { $ifNull: ['$drugAllergies', []] } }, 0],
});

const findForDrugAllergiesList = async ({
  search,
  status = 'admitted',
  recorded,
  page = 1,
  limit = 20,
} = {}) => {
  const filter = {};
  if (status) filter.residencyStatus = status;

  const and = [];
  if (search) {
    const s = search.trim();
    and.push({
      $or: [
        { fullName: { $regex: s, $options: 'i' } },
        { residentCode: { $regex: s, $options: 'i' } },
      ],
    });
  }

  const recordedNorm =
    recorded === true || recorded === 'true'
      ? true
      : recorded === false || recorded === 'false'
        ? false
        : null;

  if (recordedNorm === true) {
    and.push({ $expr: drugAllergiesRecordedExpr() });
  } else if (recordedNorm === false) {
    and.push({ $expr: { $not: [drugAllergiesRecordedExpr()] } });
  }

  if (and.length) filter.$and = and;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [data, total] = await Promise.all([
    Resident.find(filter)
      .select(
        'residentCode fullName dateOfBirth gender residencyStatus drugAllergies roomId updatedAt'
      )
      .populate(ROOM_POPULATE)
      .sort({ fullName: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Resident.countDocuments(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum };
};

const findInitialHealthByResidentId = async (residentId) =>
  Resident.findById(residentId)
    .select(
      'residentCode fullName dateOfBirth gender bloodType initialHealthCondition residencyStatus updatedAt'
    )
    .lean();

const updateInitialHealth = async (residentId, payload) =>
  Resident.findByIdAndUpdate(residentId, payload, { new: true, runValidators: true })
    .select('residentCode fullName dateOfBirth gender bloodType initialHealthCondition updatedAt')
    .lean();

const findPreExistingByResidentId = async (residentId) =>
  Resident.findById(residentId)
    .select(
      'residentCode fullName dateOfBirth gender residencyStatus chronicConditions medicalHistory roomId bedId updatedAt'
    )
    .populate(ROOM_POPULATE)
    .populate({ path: 'bedId', select: 'bedCode status' })
    .lean();

const updatePreExistingConditions = async (residentId, payload) =>
  Resident.findByIdAndUpdate(residentId, payload, { new: true, runValidators: true })
    .select('residentCode fullName chronicConditions medicalHistory updatedAt')
    .lean();

const findDrugAllergiesByResidentId = async (residentId) =>
  Resident.findById(residentId)
    .select(
      'residentCode fullName dateOfBirth gender residencyStatus drugAllergies roomId bedId updatedAt'
    )
    .populate(ROOM_POPULATE)
    .populate({ path: 'bedId', select: 'bedCode status' })
    .lean();

const updateDrugAllergies = async (residentId, payload) =>
  Resident.findByIdAndUpdate(residentId, payload, { new: true, runValidators: true })
    .select('residentCode fullName drugAllergies updatedAt')
    .lean();

module.exports = {
  findForAssignment,
  findForFamilyManagement,
  findByIdWithFamily,
  findById,
  findByResidentCode,
  createResident,
  findAll,
  countAll,
  findByIdForAdmin,
  updateById,
  findByIdWithDetail,
  findByIdForTransfer,
  updateRoomAssignment,
  addEmergencyContact,
  replaceEmergencyContacts,
  updateEmergencyContact,
  removeEmergencyContact,
  assertValidObjectId,
  resolveRoomIds,
  getAreaSummary,
  findByArea,
  findForInitialHealthList,
  findForPreExistingList,
  findForDrugAllergiesList,
  findInitialHealthByResidentId,
  updateInitialHealth,
  findPreExistingByResidentId,
  updatePreExistingConditions,
  findDrugAllergiesByResidentId,
  updateDrugAllergies,
};

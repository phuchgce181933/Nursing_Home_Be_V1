const Building = require('../models/building');
const floorRepo = require('../repositories/floorRepository');
const roomRepo = require('../repositories/roomRepository');

const formatFloorLabel = (floor) => {
  const floorName = floor.name || `Tầng ${floor.floorNumber}`;
  const buildingName = floor.buildingId?.name || floor.buildingId?.code;
  return buildingName ? `${floorName} — ${buildingName}` : floorName;
};

const listBuildings = async ({ activeOnly = true } = {}) => {
  const filter = activeOnly ? { isActive: { $ne: false } } : {};
  return Building.find(filter).select('code name address isActive').sort({ name: 1 }).lean();
};

const listFloors = async ({ buildingId, activeOnly = true } = {}) => {
  const filter = {};
  if (activeOnly) filter.isActive = { $ne: false };
  if (buildingId) filter.buildingId = buildingId;

  const floors = await floorRepo.findAll(filter);

  return floors
    .filter((f) => !activeOnly || f.buildingId?.isActive !== false)
    .map((floor) => ({
      _id: floor._id,
      floorNumber: floor.floorNumber,
      name: floor.name,
      description: floor.description,
      isActive: floor.isActive,
      buildingId: floor.buildingId?._id || floor.buildingId,
      building: floor.buildingId
        ? {
            _id: floor.buildingId._id,
            code: floor.buildingId.code,
            name: floor.buildingId.name,
          }
        : null,
      label: formatFloorLabel(floor),
    }));
};

const getFloor = async (floorId) => {
  const floor = await floorRepo.findById(floorId);
  if (!floor) throw Object.assign(new Error('Floor not found'), { status: 404 });
  const obj = floor.toObject();
  return { ...obj, label: formatFloorLabel(obj) };
};

const listRoomsByFloor = async (floorId) => {
  const floor = await floorRepo.findById(floorId);
  if (!floor) throw Object.assign(new Error('Floor not found'), { status: 404 });

  const rooms = await roomRepo.findByFloorId(floorId);
  return rooms.map((room) => ({
    ...room,
    label: `Phòng ${room.roomNumber}`,
  }));
};

const listAvailableBedsByRoom = async (roomId) => {
  const Bed = require('../models/bed');
  return Bed.find({ roomId, status: 'available' }).sort({ bedCode: 1 }).lean();
};

const createBuilding = async (data, user, req) => {
  const code = String(data.code || '').trim().toUpperCase();
  const name = String(data.name || '').trim();
  const address = String(data.address || '').trim();
  const description = String(data.description || '').trim();

  if (!code) throw Object.assign(new Error('Mã tòa nhà là bắt buộc'), { status: 400 });
  if (!name) throw Object.assign(new Error('Tên tòa nhà là bắt buộc'), { status: 400 });

  const existing = await Building.findOne({ code });
  if (existing) throw Object.assign(new Error('Mã tòa nhà đã tồn tại'), { status: 409 });

  const building = await Building.create({
    code,
    name,
    address: address || undefined,
    description: description || undefined,
    isActive: true,
  });

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'CREATE_BUILDING',
    module: 'facility',
    targetEntityType: 'Building',
    targetEntityId: building._id,
    afterData: { code: building.code, name: building.name },
    req,
  });

  return building.toObject();
};

const updateBuilding = async (buildingId, data, user, req) => {
  const building = await Building.findById(buildingId);
  if (!building) throw Object.assign(new Error('Không tìm thấy tòa nhà'), { status: 404 });

  const beforeData = { code: building.code, name: building.name, address: building.address, description: building.description, isActive: building.isActive };

  if (data.code !== undefined) {
    const nextCode = String(data.code || '').trim().toUpperCase();
    if (!nextCode) throw Object.assign(new Error('Mã tòa nhà không được để trống'), { status: 400 });
    if (nextCode !== building.code) {
      const existing = await Building.findOne({ code: nextCode });
      if (existing) throw Object.assign(new Error('Mã tòa nhà đã tồn tại'), { status: 409 });
      building.code = nextCode;
    }
  }

  if (data.name !== undefined) {
    const nextName = String(data.name || '').trim();
    if (!nextName) throw Object.assign(new Error('Tên tòa nhà không được để trống'), { status: 400 });
    building.name = nextName;
  }

  if (data.address !== undefined) {
    building.address = String(data.address || '').trim() || undefined;
  }

  if (data.description !== undefined) {
    building.description = String(data.description || '').trim() || undefined;
  }

  if (data.isActive !== undefined) {
    building.isActive = Boolean(data.isActive);
  }

  await building.save();

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'UPDATE_BUILDING',
    module: 'facility',
    targetEntityType: 'Building',
    targetEntityId: building._id,
    beforeData,
    afterData: { code: building.code, name: building.name, address: building.address, description: building.description, isActive: building.isActive },
    req,
  });

  return building.toObject();
};

const deleteBuilding = async (buildingId, user, req) => {
  const building = await Building.findById(buildingId);
  if (!building) throw Object.assign(new Error('Không tìm thấy tòa nhà'), { status: 404 });

  const beforeData = { code: building.code, name: building.name, isActive: building.isActive };

  building.isActive = false;
  await building.save();

  const Floor = require('../models/floor');
  await Floor.updateMany({ buildingId }, { isActive: false });

  const Room = require('../models/room');
  await Room.updateMany({ buildingId }, { status: 'closed' });

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'DELETE_BUILDING',
    module: 'facility',
    targetEntityType: 'Building',
    targetEntityId: building._id,
    beforeData,
    afterData: { code: building.code, name: building.name, isActive: false },
    req,
  });

  return { message: 'Tòa nhà đã được vô hiệu hóa', success: true };
};

const createFloor = async (data, user, req) => {
  const Floor = require('../models/floor');
  const buildingId = data.buildingId;
  const floorNumber = Number(data.floorNumber);
  const name = String(data.name || '').trim();
  const description = String(data.description || '').trim();

  if (!buildingId) throw Object.assign(new Error('buildingId là bắt buộc'), { status: 400 });
  if (Number.isNaN(floorNumber)) throw Object.assign(new Error('floorNumber phải là số và là bắt buộc'), { status: 400 });

  const building = await Building.findById(buildingId);
  if (!building) throw Object.assign(new Error('Không tìm thấy tòa nhà'), { status: 404 });

  const existing = await Floor.findOne({ buildingId, floorNumber });
  if (existing) throw Object.assign(new Error(`Tầng số ${floorNumber} đã tồn tại trong tòa nhà này`), { status: 409 });

  const floor = await Floor.create({
    buildingId,
    floorNumber,
    name: name || undefined,
    description: description || undefined,
    isActive: true,
  });

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'CREATE_FLOOR',
    module: 'facility',
    targetEntityType: 'Floor',
    targetEntityId: floor._id,
    afterData: { buildingId, floorNumber, name: floor.name },
    req,
  });

  return floor.toObject();
};

const updateFloor = async (floorId, data, user, req) => {
  const Floor = require('../models/floor');
  const floor = await Floor.findById(floorId);
  if (!floor) throw Object.assign(new Error('Không tìm thấy tầng'), { status: 404 });

  const beforeData = { floorNumber: floor.floorNumber, name: floor.name, description: floor.description, isActive: floor.isActive };

  if (data.floorNumber !== undefined) {
    const nextNum = Number(data.floorNumber);
    if (Number.isNaN(nextNum)) throw Object.assign(new Error('floorNumber phải là số hợp lệ'), { status: 400 });
    if (nextNum !== floor.floorNumber) {
      const existing = await Floor.findOne({ buildingId: floor.buildingId, floorNumber: nextNum });
      if (existing) throw Object.assign(new Error(`Tầng số ${nextNum} đã tồn tại trong tòa nhà này`), { status: 409 });
      floor.floorNumber = nextNum;
    }
  }

  if (data.name !== undefined) {
    floor.name = String(data.name || '').trim() || undefined;
  }

  if (data.description !== undefined) {
    floor.description = String(data.description || '').trim() || undefined;
  }

  if (data.isActive !== undefined) {
    floor.isActive = Boolean(data.isActive);
  }

  await floor.save();

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'UPDATE_FLOOR',
    module: 'facility',
    targetEntityType: 'Floor',
    targetEntityId: floor._id,
    beforeData,
    afterData: { floorNumber: floor.floorNumber, name: floor.name, description: floor.description, isActive: floor.isActive },
    req,
  });

  return floor.toObject();
};

const deleteFloor = async (floorId, user, req) => {
  const Floor = require('../models/floor');
  const floor = await Floor.findById(floorId);
  if (!floor) throw Object.assign(new Error('Không tìm thấy tầng'), { status: 404 });

  const beforeData = { floorNumber: floor.floorNumber, name: floor.name, isActive: floor.isActive };

  floor.isActive = false;
  await floor.save();

  const Room = require('../models/room');
  await Room.updateMany({ floorId }, { status: 'closed' });

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'DELETE_FLOOR',
    module: 'facility',
    targetEntityType: 'Floor',
    targetEntityId: floor._id,
    beforeData,
    afterData: { floorNumber: floor.floorNumber, name: floor.name, isActive: false },
    req,
  });

  return { message: 'Tầng đã được vô hiệu hóa', success: true };
};

const createRoom = async (data, user, req) => {
  const Room = require('../models/room');
  const Floor = require('../models/floor');
  const buildingId = data.buildingId;
  const floorId = data.floorId;
  const roomNumber = String(data.roomNumber || '').trim();
  const roomType = data.roomType || 'standard';
  const capacity = Number(data.capacity);
  const notes = String(data.notes || '').trim();

  if (!buildingId) throw Object.assign(new Error('buildingId là bắt buộc'), { status: 400 });
  if (!floorId) throw Object.assign(new Error('floorId là bắt buộc'), { status: 400 });
  if (!roomNumber) throw Object.assign(new Error('roomNumber là bắt buộc'), { status: 400 });
  if (Number.isNaN(capacity) || capacity < 1) throw Object.assign(new Error('capacity phải là số lớn hơn hoặc bằng 1'), { status: 400 });

  const floor = await Floor.findById(floorId);
  if (!floor) throw Object.assign(new Error('Không tìm thấy tầng'), { status: 404 });
  if (String(floor.buildingId) !== String(buildingId)) {
    throw Object.assign(new Error('Tầng đã chọn không thuộc tòa nhà đã chọn'), { status: 400 });
  }

  const existing = await Room.findOne({ floorId, roomNumber });
  if (existing) throw Object.assign(new Error(`Phòng số ${roomNumber} đã tồn tại ở tầng này`), { status: 409 });

  const { ROOM_TYPES } = require('../models/enums');
  if (!ROOM_TYPES.includes(roomType)) {
    throw Object.assign(new Error(`Loại phòng không hợp lệ. Phải thuộc: ${ROOM_TYPES.join(', ')}`), { status: 400 });
  }

  const room = await Room.create({
    buildingId,
    floorId,
    roomNumber,
    roomType,
    capacity,
    occupiedCount: 0,
    status: 'available',
    notes: notes || undefined,
  });

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'CREATE_ROOM',
    module: 'facility',
    targetEntityType: 'Room',
    targetEntityId: room._id,
    afterData: { buildingId, floorId, roomNumber, roomType, capacity },
    req,
  });

  return room.toObject();
};

module.exports = {
  listBuildings,
  listFloors,
  getFloor,
  listRoomsByFloor,
  listAvailableBedsByRoom,
  createBuilding,
  updateBuilding,
  deleteBuilding,
  createFloor,
  updateFloor,
  deleteFloor,
  createRoom,
};

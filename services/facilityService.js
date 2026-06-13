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

module.exports = {
  listBuildings,
  listFloors,
  getFloor,
  listRoomsByFloor,
  listAvailableBedsByRoom,
  createBuilding,
  updateBuilding,
  deleteBuilding,
};

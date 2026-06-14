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
  return Building.find(filter).select('code name address description isActive').sort({ name: 1 }).lean();
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

const listAllRooms = async ({ activeOnly = false } = {}) => {
  const Room = require('../models/room');
  const filter = activeOnly ? { status: { $ne: 'closed' } } : {};
  return Room.find(filter).select('_id roomNumber roomType status floorId buildingId').lean();
};

const listAllBeds = async ({ activeOnly = false } = {}) => {
  const Bed = require('../models/bed');
  const filter = activeOnly ? { status: { $ne: 'maintenance' } } : {};
  return Bed.find(filter).select('_id bedCode status roomId').lean();
};

const getStats = async () => {
  const [buildings, floors, rooms, beds] = await Promise.all([
    require('../models/building').countDocuments({}),
    require('../models/floor').countDocuments({}),
    require('../models/room').countDocuments({}),
    require('../models/bed').countDocuments({}),
  ]);
  return { buildingsCount: buildings, floorsCount: floors, roomsCount: rooms, bedsCount: beds };
};

const listAvailableBedsByRoom = async (roomId, { all = false } = {}) => {
  const Bed = require('../models/bed');
  const filter = { roomId };
  if (!all) {
    filter.status = 'available';
  }
  return Bed.find(filter).sort({ bedCode: 1 }).lean();
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

const updateRoom = async (roomId, data, user, req) => {
  const Room = require('../models/room');
  const room = await Room.findById(roomId);
  if (!room) throw Object.assign(new Error('Không tìm thấy phòng'), { status: 404 });

  const beforeData = { roomNumber: room.roomNumber, roomType: room.roomType, capacity: room.capacity, status: room.status, notes: room.notes };

  if (data.roomNumber !== undefined) {
    const nextNum = String(data.roomNumber || '').trim();
    if (!nextNum) throw Object.assign(new Error('roomNumber không được để trống'), { status: 400 });
    if (nextNum !== room.roomNumber) {
      const existing = await Room.findOne({ floorId: room.floorId, roomNumber: nextNum });
      if (existing) throw Object.assign(new Error(`Phòng số ${nextNum} đã tồn tại ở tầng này`), { status: 409 });
      room.roomNumber = nextNum;
    }
  }

  if (data.roomType !== undefined) {
    const { ROOM_TYPES } = require('../models/enums');
    if (!ROOM_TYPES.includes(data.roomType)) {
      throw Object.assign(new Error(`Loại phòng không hợp lệ. Phải thuộc: ${ROOM_TYPES.join(', ')}`), { status: 400 });
    }
    room.roomType = data.roomType;
  }

  if (data.capacity !== undefined) {
    const nextCap = Number(data.capacity);
    if (Number.isNaN(nextCap) || nextCap < 1) throw Object.assign(new Error('capacity phải là số lớn hơn hoặc bằng 1'), { status: 400 });
    if (nextCap < room.occupiedCount) {
      throw Object.assign(new Error(`Không thể giảm sức chứa xuống ${nextCap} vì đang có ${room.occupiedCount} cư dân đang ở phòng này`), { status: 400 });
    }
    room.capacity = nextCap;
  }

  if (data.status !== undefined) {
    const { ROOM_STATUSES } = require('../models/enums');
    if (!ROOM_STATUSES.includes(data.status)) {
      throw Object.assign(new Error('Trạng thái phòng không hợp lệ'), { status: 400 });
    }
    if (room.occupiedCount > 0 && (data.status === 'closed' || data.status === 'maintenance')) {
      throw Object.assign(new Error('Không thể chuyển trạng thái phòng đang có cư dân cư trú sang Đóng hoặc Bảo trì'), { status: 400 });
    }
    room.status = data.status;
  }

  if (data.notes !== undefined) {
    room.notes = String(data.notes || '').trim() || undefined;
  }

  if (room.status !== 'closed' && room.status !== 'maintenance') {
    room.status = room.occupiedCount >= room.capacity ? 'full' : 'available';
  }

  await room.save();

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'UPDATE_ROOM',
    module: 'facility',
    targetEntityType: 'Room',
    targetEntityId: room._id,
    beforeData,
    afterData: { roomNumber: room.roomNumber, roomType: room.roomType, capacity: room.capacity, status: room.status, notes: room.notes },
    req,
  });

  return room.toObject();
};

const deleteRoom = async (roomId, user, req) => {
  const Room = require('../models/room');
  const room = await Room.findById(roomId);
  if (!room) throw Object.assign(new Error('Không tìm thấy phòng'), { status: 404 });

  if (room.occupiedCount > 0) {
    throw Object.assign(new Error('Không thể xóa phòng đang có cư dân cư trú'), { status: 400 });
  }

  const beforeData = { roomNumber: room.roomNumber, status: room.status };

  room.status = 'closed';
  await room.save();

  const Bed = require('../models/bed');
  await Bed.updateMany({ roomId }, { status: 'maintenance' });

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'DELETE_ROOM',
    module: 'facility',
    targetEntityType: 'Room',
    targetEntityId: room._id,
    beforeData,
    afterData: { roomNumber: room.roomNumber, status: 'closed' },
    req,
  });

  return { message: 'Phòng đã được đóng thành công', success: true };
};

const createBed = async (data, user, req) => {
  const Bed = require('../models/bed');
  const Room = require('../models/room');
  const roomId = data.roomId;
  const bedCode = String(data.bedCode || '').trim();
  const bedType = data.bedType || 'normal';
  const condition = data.condition || 'good';
  const notes = String(data.notes || '').trim();

  if (!roomId) throw Object.assign(new Error('roomId là bắt buộc'), { status: 400 });
  if (!bedCode) throw Object.assign(new Error('bedCode là bắt buộc'), { status: 400 });

  const room = await Room.findById(roomId);
  if (!room) throw Object.assign(new Error('Không tìm thấy phòng'), { status: 404 });

  const existing = await Bed.findOne({ roomId, bedCode });
  if (existing) throw Object.assign(new Error(`Giường mã ${bedCode} đã tồn tại trong phòng này`), { status: 409 });

  const { BED_TYPES, BED_CONDITIONS } = require('../models/enums');
  if (!BED_TYPES.includes(bedType)) {
    throw Object.assign(new Error(`Loại giường không hợp lệ. Phải thuộc: ${BED_TYPES.join(', ')}`), { status: 400 });
  }
  if (!BED_CONDITIONS.includes(condition)) {
    throw Object.assign(new Error(`Tình trạng giường không hợp lệ. Phải thuộc: ${BED_CONDITIONS.join(', ')}`), { status: 400 });
  }

  const bed = await Bed.create({
    roomId,
    bedCode,
    bedType,
    status: 'available',
    condition,
    notes: notes || undefined,
  });

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'CREATE_BED',
    module: 'facility',
    targetEntityType: 'Bed',
    targetEntityId: bed._id,
    afterData: { roomId, bedCode, bedType, condition },
    req,
  });

  return bed.toObject();
};

const updateBed = async (bedId, data, user, req) => {
  const Bed = require('../models/bed');
  const bed = await Bed.findById(bedId);
  if (!bed) throw Object.assign(new Error('Không tìm thấy giường'), { status: 404 });

  const beforeData = { bedCode: bed.bedCode, bedType: bed.bedType, status: bed.status, condition: bed.condition, notes: bed.notes };

  if (data.bedCode !== undefined) {
    const nextCode = String(data.bedCode || '').trim();
    if (!nextCode) throw Object.assign(new Error('bedCode không được để trống'), { status: 400 });
    if (nextCode !== bed.bedCode) {
      const existing = await Bed.findOne({ roomId: bed.roomId, bedCode: nextCode });
      if (existing) throw Object.assign(new Error(`Giường mã ${nextCode} đã tồn tại trong phòng này`), { status: 409 });
      bed.bedCode = nextCode;
    }
  }

  if (data.bedType !== undefined) {
    const { BED_TYPES } = require('../models/enums');
    if (!BED_TYPES.includes(data.bedType)) {
      throw Object.assign(new Error(`Loại giường không hợp lệ. Phải thuộc: ${BED_TYPES.join(', ')}`), { status: 400 });
    }
    bed.bedType = data.bedType;
  }

  if (data.condition !== undefined) {
    const { BED_CONDITIONS } = require('../models/enums');
    if (!BED_CONDITIONS.includes(data.condition)) {
      throw Object.assign(new Error('Tình trạng giường không hợp lệ'), { status: 400 });
    }
    bed.condition = data.condition;
  }

  if (data.status !== undefined) {
    const { BED_STATUSES } = require('../models/enums');
    if (!BED_STATUSES.includes(data.status)) {
      throw Object.assign(new Error('Trạng thái giường không hợp lệ'), { status: 400 });
    }
    if (data.status === 'maintenance' && bed.status === 'occupied') {
      throw Object.assign(new Error('Không thể chuyển giường đang sử dụng sang trạng thái bảo trì'), { status: 400 });
    }
    bed.status = data.status;
  }

  if (data.notes !== undefined) {
    bed.notes = String(data.notes || '').trim() || undefined;
  }

  await bed.save();

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'UPDATE_BED',
    module: 'facility',
    targetEntityType: 'Bed',
    targetEntityId: bed._id,
    beforeData,
    afterData: { bedCode: bed.bedCode, bedType: bed.bedType, status: bed.status, condition: bed.condition, notes: bed.notes },
    req,
  });

  return bed.toObject();
};

const deleteBed = async (bedId, user, req) => {
  const Bed = require('../models/bed');
  const bed = await Bed.findById(bedId);
  if (!bed) throw Object.assign(new Error('Không tìm thấy giường'), { status: 404 });

  if (bed.status === 'occupied') {
    throw Object.assign(new Error('Không thể xóa giường đang có cư dân sử dụng'), { status: 400 });
  }

  const beforeData = { bedCode: bed.bedCode, status: bed.status };

  await Bed.findByIdAndDelete(bedId);

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'DELETE_BED',
    module: 'facility',
    targetEntityType: 'Bed',
    targetEntityId: bed._id,
    beforeData,
    afterData: null,
    req,
  });

  return { message: 'Giường đã được xóa thành công', success: true };
};

const listEquipment = async (filters = {}) => {
  const Equipment = require('../models/equipment');
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.category) query.category = filters.category;
  if (filters.roomId) query.roomId = filters.roomId;

  return Equipment.find(query)
    .populate('buildingId', 'name code')
    .populate('floorId', 'name floorNumber')
    .populate('roomId', 'roomNumber')
    .populate('bedId', 'bedCode')
    .sort({ name: 1 })
    .lean();
};

const createEquipment = async (data, user, req) => {
  const Equipment = require('../models/equipment');
  const code = String(data.code || '').trim().toUpperCase();
  const name = String(data.name || '').trim();
  const category = String(data.category || '').trim();
  const status = data.status || 'available';
  const locationType = data.locationType || 'storage';
  const notes = String(data.notes || '').trim();

  if (!code) throw Object.assign(new Error('Mã thiết bị là bắt buộc'), { status: 400 });
  if (!name) throw Object.assign(new Error('Tên thiết bị là bắt buộc'), { status: 400 });

  const existing = await Equipment.findOne({ code });
  if (existing) throw Object.assign(new Error(`Mã thiết bị ${code} đã tồn tại`), { status: 409 });

  const { EQUIPMENT_STATUSES, EQUIPMENT_LOCATION_TYPES } = require('../models/enums');
  if (!EQUIPMENT_STATUSES.includes(status)) {
    throw Object.assign(new Error('Trạng thái thiết bị không hợp lệ'), { status: 400 });
  }
  if (!EQUIPMENT_LOCATION_TYPES.includes(locationType)) {
    throw Object.assign(new Error('Loại vị trí thiết bị không hợp lệ'), { status: 400 });
  }

  const equipment = await Equipment.create({
    code,
    name,
    category: category || undefined,
    status,
    locationType,
    buildingId: data.buildingId || undefined,
    floorId: data.floorId || undefined,
    roomId: data.roomId || undefined,
    bedId: data.bedId || undefined,
    maintenanceDueAt: data.maintenanceDueAt ? new Date(data.maintenanceDueAt) : undefined,
    notes: notes || undefined,
  });

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'CREATE_EQUIPMENT',
    module: 'facility',
    targetEntityType: 'Equipment',
    targetEntityId: equipment._id,
    afterData: { code, name, category, status, locationType },
    req,
  });

  return equipment.toObject();
};

const updateEquipment = async (id, data, user, req) => {
  const Equipment = require('../models/equipment');
  const equipment = await Equipment.findById(id);
  if (!equipment) throw Object.assign(new Error('Không tìm thấy thiết bị'), { status: 404 });

  const beforeData = {
    code: equipment.code,
    name: equipment.name,
    category: equipment.category,
    status: equipment.status,
    locationType: equipment.locationType,
    buildingId: equipment.buildingId,
    floorId: equipment.floorId,
    roomId: equipment.roomId,
    bedId: equipment.bedId,
    maintenanceDueAt: equipment.maintenanceDueAt,
    notes: equipment.notes,
  };

  if (data.code !== undefined) {
    const nextCode = String(data.code || '').trim().toUpperCase();
    if (!nextCode) throw Object.assign(new Error('Mã thiết bị không được để trống'), { status: 400 });
    if (nextCode !== equipment.code) {
      const existing = await Equipment.findOne({ code: nextCode });
      if (existing) throw Object.assign(new Error(`Mã thiết bị ${nextCode} đã tồn tại`), { status: 409 });
      equipment.code = nextCode;
    }
  }

  if (data.name !== undefined) {
    const nextName = String(data.name || '').trim();
    if (!nextName) throw Object.assign(new Error('Tên thiết bị không được để trống'), { status: 400 });
    equipment.name = nextName;
  }

  if (data.category !== undefined) {
    equipment.category = String(data.category || '').trim() || undefined;
  }

  if (data.status !== undefined) {
    const { EQUIPMENT_STATUSES } = require('../models/enums');
    if (!EQUIPMENT_STATUSES.includes(data.status)) {
      throw Object.assign(new Error('Trạng thái thiết bị không hợp lệ'), { status: 400 });
    }
    equipment.status = data.status;
  }

  if (data.locationType !== undefined) {
    const { EQUIPMENT_LOCATION_TYPES } = require('../models/enums');
    if (!EQUIPMENT_LOCATION_TYPES.includes(data.locationType)) {
      throw Object.assign(new Error('Loại vị trí thiết bị không hợp lệ'), { status: 400 });
    }
    equipment.locationType = data.locationType;
  }

  // Handle locations mapping
  if (data.buildingId !== undefined) equipment.buildingId = data.buildingId || undefined;
  if (data.floorId !== undefined) equipment.floorId = data.floorId || undefined;
  if (data.roomId !== undefined) equipment.roomId = data.roomId || undefined;
  if (data.bedId !== undefined) equipment.bedId = data.bedId || undefined;

  if (data.maintenanceDueAt !== undefined) {
    equipment.maintenanceDueAt = data.maintenanceDueAt ? new Date(data.maintenanceDueAt) : undefined;
  }

  if (data.notes !== undefined) {
    equipment.notes = String(data.notes || '').trim() || undefined;
  }

  await equipment.save();

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'UPDATE_EQUIPMENT',
    module: 'facility',
    targetEntityType: 'Equipment',
    targetEntityId: equipment._id,
    beforeData,
    afterData: {
      code: equipment.code,
      name: equipment.name,
      category: equipment.category,
      status: equipment.status,
      locationType: equipment.locationType,
      notes: equipment.notes,
    },
    req,
  });

  return equipment.toObject();
};

const deleteEquipment = async (id, user, req) => {
  const Equipment = require('../models/equipment');
  const equipment = await Equipment.findById(id);
  if (!equipment) throw Object.assign(new Error('Không tìm thấy thiết bị'), { status: 404 });

  const beforeData = { code: equipment.code, status: equipment.status };

  await Equipment.findByIdAndDelete(id);

  const { createAuditLog } = require('../utils/auditLog');
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'DELETE_EQUIPMENT',
    module: 'facility',
    targetEntityType: 'Equipment',
    targetEntityId: equipment._id,
    beforeData,
    afterData: null,
    req,
  });

  return { message: 'Thiết bị đã được xóa thành công', success: true };
};

const getBuildingStats = async (buildingId) => {
  const Floor = require('../models/floor');
  const Room = require('../models/room');
  const Bed = require('../models/bed');

  const building = await Building.findById(buildingId).lean();
  if (!building) {
    throw Object.assign(new Error('Không tìm thấy tòa nhà'), { status: 404 });
  }

  const floorsCount = await Floor.countDocuments({ buildingId });
  const roomsCount = await Room.countDocuments({ buildingId });

  // Get rooms to find bed statistics
  const rooms = await Room.find({ buildingId }).select('_id').lean();
  const roomIds = rooms.map((r) => r._id);

  const totalBeds = await Bed.countDocuments({ roomId: { $in: roomIds } });

  // Aggregate bed statuses
  const bedStatsRaw = await Bed.aggregate([
    { $match: { roomId: { $in: roomIds } } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const bedStats = {
    available: 0,
    occupied: 0,
    reserved: 0,
    maintenance: 0,
  };

  bedStatsRaw.forEach((stat) => {
    if (bedStats[stat._id] !== undefined) {
      bedStats[stat._id] = stat.count;
    }
  });

  return {
    building: {
      _id: building._id,
      code: building.code,
      name: building.name,
      isActive: building.isActive,
    },
    floorsCount,
    roomsCount,
    bedsCount: totalBeds,
    bedStats,
  };
};

module.exports = {
  listBuildings,
  listFloors,
  getFloor,
  listRoomsByFloor,
  listAllRooms,
  listAllBeds,
  getStats,
  getBuildingStats,
  listAvailableBedsByRoom,
  createBuilding,
  updateBuilding,
  deleteBuilding,
  createFloor,
  updateFloor,
  deleteFloor,
  createRoom,
  updateRoom,
  deleteRoom,
  createBed,
  updateBed,
  deleteBed,
  listEquipment,
  createEquipment,
  updateEquipment,
  deleteEquipment,
};

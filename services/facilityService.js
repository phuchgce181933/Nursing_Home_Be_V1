const Floor = require('../models/floor');
const Room = require('../models/room');

const listFloors = async ({ buildingId, activeOnly } = {}) => {
  const q = {};
  if (buildingId) q.buildingId = buildingId;
  if (activeOnly) q.isActive = true;
  return Floor.find(q).sort({ floorNumber: 1 }).lean();
};

const listRooms = async ({ floorId, buildingId, activeOnly } = {}) => {
  const q = {};
  if (floorId) q.floorId = floorId;
  if (buildingId) q.buildingId = buildingId;
  if (activeOnly) q.status = 'available';
  const rooms = await Room.find(q).sort({ roomNumber: 1 }).lean();
  return rooms.map((r) => ({
    _id: r._id,
    roomNumber: r.roomNumber,
    label: r.name || (r.roomNumber ? `Phòng ${r.roomNumber}` : undefined),
    roomType: r.roomType,
    capacity: r.capacity,
    occupiedCount: r.occupiedCount,
    status: r.status,
  }));
};

const listRoomsByFloor = async (floorId) => {
  return listRooms({ floorId, activeOnly: false });
};

module.exports = { listFloors, listRooms, listRoomsByFloor };

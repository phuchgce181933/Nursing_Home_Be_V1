const Room = require('../models/room');

const findByFloorId = async (floorId, { activeOnly = true } = {}) => {
  const filter = { floorId };
  if (activeOnly) filter.status = { $nin: ['closed'] };
  return Room.find(filter)
    .select('roomNumber roomType capacity occupiedCount status floorId buildingId')
    .sort({ roomNumber: 1 })
    .lean();
};

const findById = async (id) => Room.findById(id).lean();

const adjustOccupiedCount = async (roomId, delta) => {
  const room = await Room.findById(roomId);
  if (!room) return null;

  const nextOccupiedCount = Math.max(0, (room.occupiedCount || 0) + delta);
  room.occupiedCount = nextOccupiedCount;

  if (room.status !== 'closed' && room.status !== 'maintenance') {
    room.status = nextOccupiedCount >= room.capacity ? 'full' : 'available';
  }

  await room.save();
  return room.toObject();
};

const { syncRoomOccupancy, syncAllRoomOccupancy } = require('../utils/roomOccupancySync');

module.exports = {
  findByFloorId,
  findById,
  adjustOccupiedCount,
  syncRoomOccupancy,
  syncAllRoomOccupancy,
};

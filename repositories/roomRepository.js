const mongoose = require('mongoose');
const Room = require('../models/room');

const findByFloorId = async (floorId, { activeOnly = true } = {}) => {
  const filter = { floorId: new mongoose.Types.ObjectId(floorId) };
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

const findByFilterLean = async (filter, { select } = {}) => {
  let q = Room.find(filter);
  if (select) q = q.select(select);
  return q.lean();
};

const findByFilter = async (filter) => Room.find(filter);
const findByIdDoc = async (id) => Room.findById(id);
const findOne = async (filter) => Room.findOne(filter);
const create = async (data) => Room.create(data);
const updateMany = async (filter, update) => Room.updateMany(filter, update);
const countDocuments = async (filter) => Room.countDocuments(filter);

const { syncRoomOccupancy, syncAllRoomOccupancy } = require('../utils/roomOccupancySync');

module.exports = {
  findByFloorId,
  findById,
  findByIdDoc,
  adjustOccupiedCount,
  findByFilterLean,
  findByFilter,
  findOne,
  create,
  updateMany,
  countDocuments,
  syncRoomOccupancy,
  syncAllRoomOccupancy,
};

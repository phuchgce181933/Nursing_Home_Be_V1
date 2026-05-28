const Bed = require('../models/bed');

const findById = async (id) => Bed.findById(id).lean();

const findAvailableByRoomIds = async (roomIds) => {
  if (!Array.isArray(roomIds) || roomIds.length === 0) return [];
  return Bed.find({
    roomId: { $in: roomIds },
    status: 'available',
    assignedResidentId: null,
  })
    .select('roomId bedCode bedType status')
    .sort({ bedCode: 1 })
    .lean();
};

const releaseBed = async (bedId, releasedAt = new Date()) =>
  Bed.findByIdAndUpdate(
    bedId,
    {
      status: 'available',
      assignedResidentId: null,
      releasedAt,
    },
    { new: true, runValidators: true }
  ).lean();

const occupyBed = async (bedId, residentId, assignedAt = new Date()) =>
  Bed.findByIdAndUpdate(
    bedId,
    {
      status: 'occupied',
      assignedResidentId: residentId,
      assignedAt,
      releasedAt: null,
    },
    { new: true, runValidators: true }
  ).lean();

module.exports = {
  findById,
  findAvailableByRoomIds,
  releaseBed,
  occupyBed,
};

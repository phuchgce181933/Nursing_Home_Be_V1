const Bed = require('../models/bed');

const findById = async (id) => Bed.findById(id).lean();
const findByIdDoc = async (id) => Bed.findById(id);

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

const findByFilterLean = async (filter, { select, sort } = {}) => {
  let q = Bed.find(filter);
  if (select) q = q.select(select);
  if (sort) q = q.sort(sort);
  return q.lean();
};

const findOne = async (filter) => Bed.findOne(filter);
const create = async (data) => Bed.create(data);
const updateMany = async (filter, update) => Bed.updateMany(filter, update);
const findByIdAndDelete = async (id) => Bed.findByIdAndDelete(id);
const countDocuments = async (filter) => Bed.countDocuments(filter);
const aggregate = async (pipeline) => Bed.aggregate(pipeline);

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
  findByIdDoc,
  findAvailableByRoomIds,
  findByFilterLean,
  findOne,
  create,
  updateMany,
  findByIdAndDelete,
  countDocuments,
  aggregate,
  releaseBed,
  occupyBed,
};

const StaffProfile = require('../models/staffProfile');

const findByUserId = async (userId) => StaffProfile.findOne({ userId });
const findById = async (id) => StaffProfile.findById(id);
const findByIdWithUser = async (id) => StaffProfile.findById(id).populate('userId', 'isActive isBanned fullName role');
const findByStaffCode = async (staffCode) => StaffProfile.findOne({ staffCode });
const findByUserIds = async (userIds) => StaffProfile.find({ userId: { $in: userIds } });
const findByUserIdsWithUser = async (userIds) =>
  StaffProfile.find({ userId: { $in: userIds } }).populate('userId', 'fullName role email');
const createStaffProfile = async (profileData) => StaffProfile.create(profileData);

const findByFilterLean = async (filter, { select, populate } = {}) => {
  let q = StaffProfile.find(filter);
  if (select) q = q.select(select);
  if (populate) q = q.populate(populate);
  return q.lean();
};

const updateById = async (id, data) =>
  StaffProfile.findByIdAndUpdate(id, data, { new: true, runValidators: true });

const RESPONSIBLE_AREA_POPULATE = {
  path: 'responsibleAreaIds',
  select: 'floorNumber name buildingId',
  populate: { path: 'buildingId', select: 'code name' },
};

const findByUserIdList = async (userIds) =>
  StaffProfile.find({ userId: { $in: userIds } })
    .populate(RESPONSIBLE_AREA_POPULATE)
    .populate('responsibleRoomIds', 'roomNumber roomType')
    .populate({
      path: 'assignedResidentIds',
      select: 'fullName residentCode roomId residencyStatus',
      populate: { path: 'roomId', select: 'roomNumber floorId' },
    });

const findByIds = async (ids) => StaffProfile.find({ _id: { $in: ids } });

const findByAreaId = async (floorId) =>
  StaffProfile.find({ responsibleAreaIds: floorId })
    .populate('userId', 'fullName role avatarUrl isActive isBanned')
    .populate(RESPONSIBLE_AREA_POPULATE)
    .populate('responsibleRoomIds', 'roomNumber roomType');

const findByRoomId = async (roomId) =>
  StaffProfile.find({ responsibleRoomIds: roomId })
    .populate('userId', 'fullName role avatarUrl isActive isBanned');

const findByAssignedResidentId = async (residentId) =>
  StaffProfile.find({ assignedResidentIds: residentId }).populate('userId', 'role');

const findByIdWithAreas = async (id) =>
  StaffProfile.findById(id)
    .populate('responsibleAreaIds')
    .populate('responsibleRoomIds')
    .populate('assignedResidentIds');

const findByIdPopulated = async (id, populates) => {
  let q = StaffProfile.findById(id);
  for (const p of Array.isArray(populates) ? populates : [populates]) {
    q = q.populate(p);
  }
  return q;
};

const findOnePopulated = async (filter, populates) => {
  let q = StaffProfile.findOne(filter);
  for (const p of Array.isArray(populates) ? populates : [populates]) {
    q = q.populate(p);
  }
  return q;
};

const findOneLean = async (filter, { select } = {}) => {
  let q = StaffProfile.findOne(filter);
  if (select) q = q.select(select);
  return q.lean();
};

const updateOne = async (filter, update, opts = {}) =>
  StaffProfile.updateOne(filter, update, opts);

module.exports = {
  findByUserId,
  findById,
  findByIdWithUser,
  findByStaffCode,
  findByUserIds,
  findByUserIdsWithUser,
  findByUserIdList,
  findByIds,
  findByAreaId,
  findByRoomId,
  findByAssignedResidentId,
  createStaffProfile,
  findByFilterLean,
  findByIdWithAreas,
  findByIdPopulated,
  findOnePopulated,
  findOneLean,
  updateOne,
  updateById,
};

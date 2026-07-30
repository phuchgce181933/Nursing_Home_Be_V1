const StaffProfile = require('../models/staffProfile');

const findByUserId = async (userId) => StaffProfile.findOne({ userId });
const findById = async (id) => StaffProfile.findById(id);
const findByIdWithUser = async (id) => StaffProfile.findById(id).populate('userId', 'isActive isBanned fullName');
const findByStaffCode = async (staffCode) => StaffProfile.findOne({ staffCode });
const findByUserIds = async (userIds) => StaffProfile.find({ userId: { $in: userIds } });
const createStaffProfile = async (profileData) => StaffProfile.create(profileData);

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

module.exports = {
  findByUserId,
  findById,
  findByIdWithUser,
  findByStaffCode,
  findByUserIds,
  findByUserIdList,
  findByIds,
  findByAreaId,
  findByRoomId,
  findByAssignedResidentId,
  createStaffProfile,
  updateById,
};

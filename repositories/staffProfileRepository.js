const StaffProfile = require('../models/staffProfile');

const findByUserId = async (userId) => StaffProfile.findOne({ userId });
const findById = async (id) => StaffProfile.findById(id);
const findByStaffCode = async (staffCode) => StaffProfile.findOne({ staffCode });
const findByUserIds = async (userIds) => StaffProfile.find({ userId: { $in: userIds } });
const createStaffProfile = async (profileData) => StaffProfile.create(profileData);

const updateById = async (id, data) =>
  StaffProfile.findByIdAndUpdate(id, data, { new: true, runValidators: true });

const findByUserIdList = async (userIds) =>
  StaffProfile.find({ userId: { $in: userIds } })
    .populate('responsibleAreaIds', 'floorNumber name')
    .populate('responsibleRoomIds', 'roomNumber roomType')
    .populate('assignedResidentIds', 'fullName residentCode');

const findByIds = async (ids) => StaffProfile.find({ _id: { $in: ids } });

const findByAreaId = async (floorId) =>
  StaffProfile.find({ responsibleAreaIds: floorId })
    .populate('userId', 'fullName role avatarUrl isActive isBanned')
    .populate('responsibleAreaIds', 'floorNumber name')
    .populate('responsibleRoomIds', 'roomNumber roomType');

const findByRoomId = async (roomId) =>
  StaffProfile.find({ responsibleRoomIds: roomId })
    .populate('userId', 'fullName role avatarUrl isActive isBanned');

const findByAssignedResidentId = async (residentId) =>
  StaffProfile.find({ assignedResidentIds: residentId }).populate('userId', 'role');

module.exports = {
  findByUserId,
  findById,
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

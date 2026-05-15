const StaffProfile = require('../models/staffProfile');

const findByUserId = async (userId) => StaffProfile.findOne({ userId });
const findById = async (id) => StaffProfile.findById(id);
const findByStaffCode = async (staffCode) => StaffProfile.findOne({ staffCode });
const findByUserIds = async (userIds) => StaffProfile.find({ userId: { $in: userIds } });
const createStaffProfile = async (profileData) => StaffProfile.create(profileData);

module.exports = {
  findByUserId,
  findById,
  findByStaffCode,
  findByUserIds,
  createStaffProfile,
};

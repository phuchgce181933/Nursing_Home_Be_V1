const User = require('../models/user');

const findByEmail = async (email) => User.findOne({ email: email.toLowerCase().trim() });
const findById = async (id) => User.findById(id);
const findByUsername = async (username) => User.findOne({ username: username.trim() });

const createUser = async (userData) => User.create(userData);

const saveUser = async (user) => user.save();

const findStaffUsers = async (filter, { skip = 0, limit = 20 } = {}) =>
  User.find(filter)
    .select('-passwordHash -resetPasswordTokenHash')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

const countStaffUsers = async (filter) => User.countDocuments(filter);
  
const updateProfile = async (userId, data) => {
  const allowedFields = {};
  if (data.fullName !== undefined) allowedFields.fullName = data.fullName;
  if (data.email !== undefined) allowedFields.email = String(data.email).toLowerCase().trim();
  if (data.phone !== undefined) allowedFields.phone = data.phone;
  if (data.gender !== undefined) allowedFields.gender = data.gender;
  if (data.avatarUrl !== undefined) allowedFields.avatarUrl = data.avatarUrl;
  if (data.avatarPublicId !== undefined) allowedFields.avatarPublicId = data.avatarPublicId;
  if (data.dateOfBirth !== undefined) allowedFields.dateOfBirth = data.dateOfBirth;
  if (data.address !== undefined) allowedFields.address = data.address;

  return await User.findByIdAndUpdate(
    userId,
    allowedFields,
    {
      new: true,
    }
  ).select('-password');
};
const findOne = (filter) => {
  return User.findOne(filter);
};
module.exports = {
  findByEmail,
  findById,
  findByUsername,
  createUser,
  saveUser,
  findStaffUsers,
  countStaffUsers,
  updateProfile,
  findOne
};

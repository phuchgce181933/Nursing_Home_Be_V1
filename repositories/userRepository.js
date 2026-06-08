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
  const allowedFields = {
    fullName: data.fullName,
    phone: data.phone,
    gender: data.gender,
  };

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

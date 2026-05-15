const User = require('../models/user');

const findByEmail = async (email) => User.findOne({ email: email.toLowerCase().trim() });
const findById = async (id) => User.findById(id);

const createUser = async (userData) => User.create(userData);

const saveUser = async (user) => user.save();

const findStaffUsers = async (filter, { skip = 0, limit = 20 } = {}) =>
  User.find(filter)
    .select('-passwordHash -resetPasswordTokenHash')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

const countStaffUsers = async (filter) => User.countDocuments(filter);

module.exports = {
  findByEmail,
  findById,
  createUser,
  saveUser,
  findStaffUsers,
  countStaffUsers,
};

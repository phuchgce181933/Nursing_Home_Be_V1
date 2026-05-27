const mongoose = require('mongoose');
const ServiceError = require('../services/serviceError');
const userRepo = require('../repositories/userRepository');
const { NON_ASSIGNABLE_ROLES } = require('../models/enums');

const isAssignableRole = (role) => {
  if (!role) return false;
  return !NON_ASSIGNABLE_ROLES.includes(String(role).trim().toLowerCase());
};

const getAssignableFlags = (role) => {
  const ok = isAssignableRole(role);
  return { shift: ok, careTask: ok, areas: ok, residents: ok };
};

const assertAssignableRole = (role) => {
  if (!isAssignableRole(role)) {
    throw new ServiceError(
      'Cannot assign shifts, tasks, areas, or residents to admin or manager accounts',
      400
    );
  }
};

const assertAssignableStaffByUserId = async (userId) => {
  const user = await userRepo.findById(userId);
  if (!user) throw new ServiceError('Staff not found', 404);
  assertAssignableRole(user.role);
  return user;
};

const assertAssignableStaffProfile = async (profile) => {
  if (!profile) throw new ServiceError('Staff profile not found', 404);
  let role;
  if (profile.userId && typeof profile.userId === 'object' && profile.userId.role) {
    role = profile.userId.role;
  } else {
    const user = await userRepo.findById(profile.userId);
    if (!user) throw new ServiceError('Staff not found', 404);
    role = user.role;
  }
  assertAssignableRole(role);
  return role;
};

const parseResidentIds = (input) => {
  if (input === undefined || input === null) return [];
  if (Array.isArray(input)) {
    return input.map((id) => String(id).trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }
  throw new ServiceError('residentIds must be an array or comma-separated string', 400);
};

const validateObjectIds = (ids, label = 'id') => {
  const invalid = ids.filter((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalid.length) {
    throw new ServiceError(`Invalid ${label}(s): ${invalid.join(', ')}`, 400);
  }
  return ids.map((id) => new mongoose.Types.ObjectId(id));
};

module.exports = {
  isAssignableRole,
  getAssignableFlags,
  assertAssignableRole,
  assertAssignableStaffByUserId,
  assertAssignableStaffProfile,
  parseResidentIds,
  validateObjectIds,
};

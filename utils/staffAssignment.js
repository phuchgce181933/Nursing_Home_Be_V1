const mongoose = require('mongoose');
const ServiceError = require('../services/serviceError');
const userRepo = require('../repositories/userRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const { NON_ASSIGNABLE_ROLES, CARE_TASK_ASSIGNEE_ROLES } = require('../models/enums');

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

const assertCareTaskAssigneeRole = (role) => {
  if (!CARE_TASK_ASSIGNEE_ROLES.includes(String(role || '').trim().toLowerCase())) {
    throw new ServiceError(
      'Chỉ có thể giao nhiệm vụ chăm sóc cho y tá hoặc bác sĩ',
      400
    );
  }
};

const idOf = (value) => String(value?._id || value || '');

const assertActorOwnsCareTask = async (task, actorUserId) => {
  if (!actorUserId) {
    throw new ServiceError('Bạn không có quyền cập nhật trạng thái nhiệm vụ này', 403);
  }
  const profile = await staffProfileRepo.findByUserId(actorUserId);
  if (!profile) {
    throw new ServiceError('Bạn không có quyền cập nhật trạng thái nhiệm vụ này', 403);
  }
  if (idOf(task.staffProfileId) !== idOf(profile._id)) {
    throw new ServiceError('Chỉ nhân viên được giao nhiệm vụ mới có thể xác nhận đang làm hoặc hoàn thành', 403);
  }
  return profile;
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

/**
 * When staff has specific responsibleRoomIds, only those rooms count (not the whole floor).
 * Floor-wide access applies only when no rooms are explicitly assigned.
 */
const residentCoversStaffArea = (resident, profile) => {
  const roomId = resident.roomId?._id?.toString() || resident.roomId?.toString();
  if (!roomId) return false;

  const assignedRoomIds = (profile.responsibleRoomIds || []).map((r) => String(r._id || r));
  if (assignedRoomIds.length > 0) {
    return assignedRoomIds.includes(roomId);
  }

  const floorId =
    resident.roomId?.floorId?._id?.toString() ||
    resident.roomId?.floorId?.toString();
  if (!floorId) return false;

  const floorIds = (profile.responsibleAreaIds || []).map((f) => String(f._id || f));
  return floorIds.includes(floorId);
};

module.exports = {
  isAssignableRole,
  getAssignableFlags,
  assertAssignableRole,
  assertCareTaskAssigneeRole,
  assertActorOwnsCareTask,
  assertAssignableStaffByUserId,
  assertAssignableStaffProfile,
  parseResidentIds,
  validateObjectIds,
  residentCoversStaffArea,
};

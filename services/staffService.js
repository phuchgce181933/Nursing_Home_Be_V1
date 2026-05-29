const ServiceError = require('./serviceError');
const userRepo = require('../repositories/userRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const shiftRepo = require('../repositories/shiftRepository');
const leaveRequestRepo = require('../repositories/leaveRequestRepository');
const careTaskRepo = require('../repositories/careTaskRepository');
const Floor = require('../models/floor');
const Room = require('../models/room');
const Resident = require('../models/resident');
const StaffProfile = require('../models/staffProfile');
const {
  assertAssignableStaffByUserId,
  getAssignableFlags,
  parseResidentIds,
  validateObjectIds,
  residentCoversStaffArea,
} = require('../utils/staffAssignment');
const {
  assertNoActiveCareTasksForResidents,
  getResidentIdsRemovedByAreaChange,
} = require('../utils/careTaskGuards');
const cloudinary = require('../config/cloudinaryConfig');
const bcrypt = require('bcryptjs');
const {
  validateFullName,
  validatePhone,
  validateDateOfBirth,
  validatePassword,
  collectErrors,
} = require('../utils/validators');
const { GENDERS } = require('../models/enums');
const {
  assertActorMayAssignRole,
  assertActorMayManageUser,
  getCreatableRolesForActor,
} = require('../utils/rolePolicy');
const { isShiftActiveNow, parseWorkDate, getLocalDateString } = require('../utils/shiftTime');

const STAFF_ROLES = ['doctor', 'nurse', 'manager', 'staff', 'admin'];

// ── helpers ────────────────────────────────────────────────────────────────

const safeDeleteCloudinaryImage = (publicId) => {
  if (!publicId) return;
  cloudinary.uploader.destroy(publicId).catch((err) =>
    console.warn(`Could not delete Cloudinary image ${publicId}:`, err.message)
  );
};

// ── shift summary for assignment UI ───────────────────────────────────────

const buildShiftSummary = (shifts, onLeave, assignmentDateStr) => {
  const shiftsOnDate = shifts.map((s) => ({
    _id: s._id,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    status: s.status,
  }));
  const shiftTimeLabel = shiftsOnDate.length
    ? shiftsOnDate.map((s) => `${s.startTime} – ${s.endTime}`).join(', ')
    : '';
  return {
    assignmentDate: assignmentDateStr,
    hasShiftOnDate: shiftsOnDate.length > 0,
    onLeave,
    shiftsOnDate,
    shiftTimeLabel,
  };
};

const resolveAssignmentDate = (assignmentDate, date) => {
  const dateParam = assignmentDate !== undefined ? assignmentDate : date;
  if (dateParam === undefined) return null;

  let assignmentDateStr;
  if (!dateParam || String(dateParam).trim() === '') {
    assignmentDateStr = getLocalDateString();
  } else {
    assignmentDateStr = String(dateParam).trim();
  }

  try {
    parseWorkDate(assignmentDateStr);
  } catch {
    throw new ServiceError('assignmentDate must be YYYY-MM-DD', 400);
  }

  return { assignmentDateStr, checkDate: parseWorkDate(assignmentDateStr) };
};

// ── STT 1 – list staff profiles ────────────────────────────────────────────

const listStaffProfiles = async ({
  role,
  isActive,
  isBanned,
  search,
  page = 1,
  limit = 20,
  assignmentDate,
  date,
}) => {
  const filter = { role: { $in: STAFF_ROLES } };
  if (role) {
    if (!STAFF_ROLES.includes(role)) throw new ServiceError(`role must be one of: ${STAFF_ROLES.join(', ')}`, 400);
    filter.role = role;
  }
  if (isActive !== undefined) filter.isActive = isActive === 'true' || isActive === true;
  if (isBanned !== undefined) filter.isBanned = isBanned === 'true' || isBanned === true;
  if (search) {
    const s = search.trim();
    filter.$or = [
      { fullName: { $regex: s, $options: 'i' } },
      { email: { $regex: s, $options: 'i' } },
      { username: { $regex: s, $options: 'i' } },
    ];
  }

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * limitNum;

  const dateCtx = resolveAssignmentDate(assignmentDate, date);
  const includeShiftSummary = dateCtx !== null;

  const [users, total] = await Promise.all([
    userRepo.findStaffUsers(filter, { skip, limit: limitNum }),
    userRepo.countStaffUsers(filter),
  ]);

  const userIds = users.map((u) => u._id);
  const profiles = await staffProfileRepo.findByUserIdList(userIds);
  const profileMap = Object.fromEntries(profiles.map((p) => [p.userId.toString(), p]));

  let shiftsByProfileId = {};
  let onLeaveSet = new Set();

  if (includeShiftSummary) {
    const { assignmentDateStr, checkDate } = dateCtx;
    const dayEnd = new Date(checkDate.getTime() + 24 * 60 * 60 * 1000 - 1);

    const profileIds = profiles.map((p) => p._id);
    const [allShifts, onLeaveRecords] = await Promise.all([
      shiftRepo.findShiftsByStaffIdsOnDate(profileIds, checkDate),
      leaveRequestRepo.findOverlappingApprovedByDate(checkDate, dayEnd),
    ]);

    shiftsByProfileId = allShifts.reduce((acc, s) => {
      const pid = s.assignedStaffId.toString();
      if (!acc[pid]) acc[pid] = [];
      acc[pid].push(s);
      return acc;
    }, {});

    onLeaveSet = new Set(
      onLeaveRecords.map((r) => (r.staffId?._id || r.staffId).toString())
    );
  }

  const data = users.map((u) => {
    const uid = u._id.toString();
    const profile = profileMap[uid] || null;
    const item = {
      ...u.toObject(),
      staffProfile: profile,
      assignable: getAssignableFlags(u.role),
    };

    if (includeShiftSummary) {
      const profileId = profile?._id?.toString();
      const shifts = profileId ? shiftsByProfileId[profileId] || [] : [];
      item.shiftSummary = buildShiftSummary(
        shifts,
        onLeaveSet.has(uid),
        dateCtx.assignmentDateStr
      );
    }

    return item;
  });

  const result = {
    data,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
  };

  if (includeShiftSummary) {
    result.assignmentDate = dateCtx.assignmentDateStr;
  }

  return result;
};

// ── STT 1 – get staff profile detail (full info, no security fields) ───────

const getStaffProfile = async (id) => {
  const user = await userRepo.findById(id);
  if (!user || !STAFF_ROLES.includes(user.role)) throw new ServiceError('Staff not found', 404);

  const userObj = user.toObject({ versionKey: false });
  // Remove all security-sensitive fields before returning
  delete userObj.passwordHash;
  delete userObj.resetPasswordTokenHash;
  delete userObj.resetPasswordExpiresAt;

  const profile = await staffProfileRepo.findByUserId(id);
  return { ...userObj, staffProfile: profile || null };
};

// ── STT 1 – update staff basic profile (admin/manager editable fields only) ─

const updateStaffProfile = async (id, body, currentUser) => {
  const user = await userRepo.findById(id);
  if (!user || !STAFF_ROLES.includes(user.role)) throw new ServiceError('Staff not found', 404);
  assertActorMayManageUser(currentUser, user);

  const { fullName, phone, gender, dateOfBirth, address, avatarUrl, avatarPublicId, specialty, certifications, password } = body;

  // Validate only the fields that are provided
  const validationError = collectErrors([
    () => (fullName !== undefined ? validateFullName(fullName) : null),
    () => (phone !== undefined ? validatePhone(phone) : null),
    () => (dateOfBirth !== undefined ? validateDateOfBirth(dateOfBirth) : null),
    () => (password !== undefined ? validatePassword(password) : null),
  ]);
  if (validationError) throw new ServiceError(validationError, 400);

  if (gender !== undefined && !GENDERS.includes(gender)) {
    throw new ServiceError(`gender must be one of: ${GENDERS.join(', ')}`, 400);
  }

  // If a new avatar is uploaded and there was an old one on Cloudinary, delete the old one
  if (avatarPublicId && user.avatarPublicId && user.avatarPublicId !== avatarPublicId) {
    safeDeleteCloudinaryImage(user.avatarPublicId);
  }

  if (fullName !== undefined) user.fullName = fullName.trim();
  if (phone !== undefined) user.phone = phone?.trim() || undefined;
  if (gender !== undefined) user.gender = gender;
  if (dateOfBirth !== undefined) user.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : undefined;
  if (address !== undefined) user.address = address?.trim() || undefined;
  if (avatarUrl !== undefined) user.avatarUrl = avatarUrl || undefined;
  if (avatarPublicId !== undefined) user.avatarPublicId = avatarPublicId || undefined;
  if (password !== undefined) {
    user.passwordHash = await bcrypt.hash(password, 10);
    user.passwordChangedAt = new Date();
  }

  await userRepo.saveUser(user);

  let profile = await staffProfileRepo.findByUserId(id);
  if (profile) {
    const profileUpdate = {};
    if (specialty !== undefined) profileUpdate.specialty = specialty?.trim() || undefined;
    if (certifications !== undefined) profileUpdate.certifications = Array.isArray(certifications) ? certifications : [];
    if (profile.roleCategory !== user.role) {
      profileUpdate.roleCategory = user.role;
    }
    if (Object.keys(profileUpdate).length) {
      profile = await staffProfileRepo.updateById(profile._id, profileUpdate);
    }
  }

  const userObj = user.toObject({ versionKey: false });
  delete userObj.passwordHash;
  delete userObj.resetPasswordTokenHash;
  delete userObj.resetPasswordExpiresAt;

  return { message: 'Staff profile updated', user: userObj, staffProfile: profile };
};

// ── STT 2 – classify staff role ─────────────────────────────────────────────

const updateStaffRole = async (id, { role }, currentUser) => {
  if (!role) throw new ServiceError('role is required', 400);

  const user = await userRepo.findById(id);
  if (!user || !STAFF_ROLES.includes(user.role)) throw new ServiceError('Staff not found', 404);
  if (user._id.toString() === currentUser._id.toString()) {
    throw new ServiceError('Cannot change your own role', 400);
  }
  assertActorMayManageUser(currentUser, user);

  assertActorMayAssignRole(currentUser, role);
  const allowedRoles = getCreatableRolesForActor(currentUser) || STAFF_ROLES;
  if (!allowedRoles.includes(role)) {
    throw new ServiceError(`role must be one of: ${allowedRoles.join(', ')}`, 400);
  }

  user.role = role;
  await userRepo.saveUser(user);

  let profile = await staffProfileRepo.findByUserId(id);
  if (profile) {
    profile = await staffProfileRepo.updateById(profile._id, { roleCategory: role });
  }

  return { message: 'Staff role updated', user: { _id: user._id, role: user.role }, staffProfile: profile };
};

// ── Ban / Unban (replaces delete) ───────────────────────────────────────────

const banStaff = async (id, { banReason } = {}, currentUser) => {
  const user = await userRepo.findById(id);
  if (!user || !STAFF_ROLES.includes(user.role)) throw new ServiceError('Staff not found', 404);
  if (user._id.toString() === currentUser._id.toString()) {
    throw new ServiceError('Cannot ban your own account', 400);
  }
  assertActorMayManageUser(currentUser, user);
  if (user.isBanned) throw new ServiceError('Staff is already banned', 400);

  user.isBanned = true;
  user.banReason = banReason?.trim() || 'Banned by administrator';
  await userRepo.saveUser(user);

  return {
    message: 'Staff account banned',
    user: { _id: user._id, fullName: user.fullName, isBanned: user.isBanned, banReason: user.banReason },
  };
};

const unbanStaff = async (id, currentUser) => {
  const user = await userRepo.findById(id);
  if (!user || !STAFF_ROLES.includes(user.role)) throw new ServiceError('Staff not found', 404);
  if (user._id.toString() === currentUser._id.toString()) {
    throw new ServiceError('Cannot unban your own account', 400);
  }
  assertActorMayManageUser(currentUser, user);
  if (!user.isBanned) throw new ServiceError('Staff is not banned', 400);

  user.isBanned = false;
  user.banReason = undefined;
  await userRepo.saveUser(user);

  return {
    message: 'Staff account unbanned',
    user: { _id: user._id, fullName: user.fullName, isBanned: user.isBanned },
  };
};

// ── STT 8 – assign responsible areas ────────────────────────────────────────

const validateStaffAreaAssignment = async (floorIds, roomIds) => {
  const allowedFloors = new Set();

  if (floorIds?.length) {
    const floors = await Floor.find({ _id: { $in: floorIds }, isActive: { $ne: false } });
    if (floors.length !== floorIds.length) {
      throw new ServiceError('One or more floorIds are invalid or inactive', 400);
    }
    floors.forEach((f) => allowedFloors.add(String(f._id)));
  }

  if (roomIds?.length) {
    const rooms = await Room.find({ _id: { $in: roomIds }, status: { $nin: ['closed'] } });
    if (rooms.length !== roomIds.length) {
      throw new ServiceError('One or more roomIds are invalid or closed', 400);
    }
    for (const room of rooms) {
      const roomFloor = String(room.floorId);
      if (allowedFloors.size && !allowedFloors.has(roomFloor)) {
        throw new ServiceError(`Room ${room.roomNumber} does not belong to any assigned floor`, 400);
      }
      allowedFloors.add(roomFloor);
    }
  }
};

const pruneAssignedResidentsToAreas = async (profile) => {
  const populated = await StaffProfile.findById(profile._id)
    .populate({
      path: 'assignedResidentIds',
      select: 'fullName residentCode roomId',
      populate: { path: 'roomId', select: 'roomNumber floorId' },
    })
    .populate('responsibleAreaIds', 'floorNumber name')
    .populate('responsibleRoomIds', 'roomNumber roomType');

  if (!populated) throw new ServiceError('Staff profile not found', 404);

  const current = populated.assignedResidentIds || [];
  const kept = current.filter((r) => residentCoversStaffArea(r, populated));
  const keptIds = kept.map((r) => r._id);

  const beforeIds = current.map((r) => String(r._id || r)).sort();
  const afterIds = keptIds.map((id) => String(id)).sort();
  const changed =
    beforeIds.length !== afterIds.length || beforeIds.some((id, i) => id !== afterIds[i]);

  const keptIdSet = new Set(afterIds);
  const removed = current.filter((r) => !keptIdSet.has(String(r._id || r)));

  if (changed) {
    await staffProfileRepo.updateById(profile._id, { assignedResidentIds: keptIds });
  }

  const removedResidents = removed.map((r) => ({
    _id: r._id,
    fullName: r.fullName,
    residentCode: r.residentCode,
    roomNumber: r.roomId?.roomNumber,
  }));

  const staffProfile = await StaffProfile.findById(profile._id)
    .populate('assignedResidentIds', 'fullName residentCode roomId')
    .populate('responsibleAreaIds', 'floorNumber name')
    .populate('responsibleRoomIds', 'roomNumber roomType');

  return {
    staffProfile,
    removedResidents,
    removedCount: removedResidents.length,
  };
};

const assignAreas = async (id, { floorIds, roomIds }) => {
  await assertAssignableStaffByUserId(id);

  const profile = await staffProfileRepo.findByUserId(id);
  if (!profile) throw new ServiceError('Staff profile not found', 404);

  const updateData = {};
  if (floorIds !== undefined) updateData.responsibleAreaIds = floorIds;
  if (roomIds !== undefined) updateData.responsibleRoomIds = roomIds;

  if (!Object.keys(updateData).length) throw new ServiceError('floorIds or roomIds required', 400);

  await validateStaffAreaAssignment(floorIds, roomIds);

  if (roomIds?.length && floorIds === undefined) {
    const rooms = await Room.find({ _id: { $in: roomIds } }).select('floorId');
    const derivedFloors = [...new Set(rooms.map((r) => r.floorId.toString()))];
    const existing = (profile.responsibleAreaIds || []).map((f) => String(f));
    updateData.responsibleAreaIds = [...new Set([...existing, ...derivedFloors])];
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1);

  const user = await userRepo.findById(id);
  if (user) {
    const onLeave = await leaveRequestRepo.findApprovedOverlapping(user._id, today, todayEnd);
    if (onLeave.length) {
      throw new ServiceError('Cannot assign areas: staff has an approved leave for today', 400);
    }
  }

  const residentIdsToRemove = await getResidentIdsRemovedByAreaChange(profile, updateData, {
    floorIds,
    roomIds,
  });
  await assertNoActiveCareTasksForResidents(profile._id, residentIdsToRemove);

  const updated = await staffProfileRepo.updateById(profile._id, updateData);
  const { staffProfile, removedResidents, removedCount } = await pruneAssignedResidentsToAreas(updated);

  return {
    message: 'Responsible areas updated',
    staffProfile,
    residentsPruned: { count: removedCount, removed: removedResidents },
  };
};

// ── STT 9 – assign elderly care duties ──────────────────────────────────────

const listResidentsAvailableForStaff = async (userId, { search, status } = {}) => {
  const profile = await staffProfileRepo.findByUserId(userId);
  if (!profile) throw new ServiceError('Staff profile not found', 404);

  const assignedRoomIds = (profile.responsibleRoomIds || []).map((r) => r._id || r);
  const assignedFloorIds = (profile.responsibleAreaIds || []).map((f) => f._id || f);

  if (!assignedRoomIds.length && !assignedFloorIds.length) {
    return {
      data: [],
      total: 0,
      filterMode: 'none',
      message: 'Staff has no assigned floors or rooms. Assign areas first.',
    };
  }

  const residentRepo = require('../repositories/residentRepository');
  const filterMode = assignedRoomIds.length > 0 ? 'rooms' : 'floors';

  const data = await residentRepo.findForAssignment({
    roomIds: assignedRoomIds.length ? assignedRoomIds : undefined,
    floorIds: assignedRoomIds.length ? undefined : assignedFloorIds,
    search,
    status: status || 'admitted',
  });

  return { data, total: data.length, filterMode };
};

const listAssignedResidents = async (userId) => {
  const profile = await StaffProfile.findOne({ userId })
    .populate({
      path: 'assignedResidentIds',
      select: 'fullName residentCode roomId residencyStatus',
      populate: { path: 'roomId', select: 'roomNumber floorId' },
    });

  if (!profile) throw new ServiceError('Staff profile not found', 404);

  const data = profile.assignedResidentIds || [];
  const result = {
    data,
    total: data.length,
  };

  if (!data.length) {
    result.message =
      'No residents assigned to this staff. Assign residents in the Residents tab before creating care tasks.';
  }

  return result;
};

const assignResidents = async (id, { residentIds: residentIdsInput }) => {
  await assertAssignableStaffByUserId(id);

  const profile = await staffProfileRepo.findByUserId(id);
  if (!profile) throw new ServiceError('Staff profile not found', 404);

  const parsedIds = parseResidentIds(residentIdsInput);
  const objectIds = validateObjectIds(parsedIds, 'residentId');

  if (objectIds.length) {
    const residents = await Resident.find({ _id: { $in: objectIds } })
      .populate({ path: 'roomId', select: 'roomNumber floorId' });

    if (residents.length !== objectIds.length) {
      const found = new Set(residents.map((r) => r._id.toString()));
      const missing = parsedIds.filter((rid) => !found.has(rid));
      throw new ServiceError(`Resident(s) not found: ${missing.join(', ')}`, 400);
    }

    const outOfArea = residents.filter((r) => !residentCoversStaffArea(r, profile));
    if (outOfArea.length) {
      const names = outOfArea.map((r) => r.fullName || r.residentCode || r._id).join(', ');
      throw new ServiceError(
        `Cannot assign resident(s) outside staff responsible area: ${names}. Assign floors/rooms first.`,
        400
      );
    }
  }

  const currentIds = (profile.assignedResidentIds || []).map((rid) => String(rid._id || rid));
  const newIdSet = new Set(objectIds.map((oid) => String(oid)));
  const removedIds = currentIds.filter((rid) => !newIdSet.has(rid));
  await assertNoActiveCareTasksForResidents(profile._id, removedIds);

  await staffProfileRepo.updateById(profile._id, { assignedResidentIds: objectIds });

  const staffProfile = await StaffProfile.findById(profile._id)
    .populate('assignedResidentIds', 'fullName residentCode roomId')
    .populate('responsibleAreaIds', 'floorNumber name')
    .populate('responsibleRoomIds', 'roomNumber roomType');

  return { message: 'Assigned residents updated', staffProfile };
};

// ── STT 10 – check doctor/nurse availability (emergency readiness) ───────────

const resolveUserIdFromShift = (shift) => {
  const staff = shift.assignedStaffId;
  if (!staff) return null;
  const u = staff.userId;
  if (!u) return null;
  return (u._id || u).toString();
};

const resolveUserIdFromProfile = (profile) => {
  if (!profile?.userId) return null;
  const u = profile.userId;
  return (u._id || u).toString();
};

const formatCurrentShift = (shift) => {
  if (!shift) return null;
  return {
    _id: shift._id,
    name: shift.name,
    startTime: shift.startTime,
    endTime: shift.endTime,
    status: shift.status,
  };
};

const isShiftActiveForCheck = (startTime, endTime, isToday, now) => {
  if (!isToday) return true;
  return isShiftActiveNow(startTime, endTime, now);
};

const formatAvailabilityStaffRow = (user, profile, readinessFields, shiftFields) => ({
  _id: user._id,
  fullName: user.fullName,
  email: user.email,
  role: user.role,
  avatarUrl: user.avatarUrl,
  phone: user.phone ?? null,
  staffCode: profile?.staffCode ?? null,
  specialty: profile?.specialty ?? null,
  certifications: profile?.certifications ?? [],
  staffProfile: profile || null,
  ...readinessFields,
  ...shiftFields,
});

const classifyReadiness = (onLeave, onShift, hasTasks) => {
  if (onLeave) {
    return {
      readinessLevel: 'on_leave',
      readinessLabelVi: 'Nghỉ phép',
      availabilityStatus: 'On Leave',
    };
  }
  if (onShift && hasTasks) {
    return {
      readinessLevel: 'caring',
      readinessLabelVi: 'Đang chăm sóc',
      availabilityStatus: 'On Duty',
    };
  }
  if (onShift) {
    return {
      readinessLevel: 'ready',
      readinessLabelVi: 'Sẵn sàng',
      availabilityStatus: 'Available',
    };
  }
  return {
    readinessLevel: 'off_duty',
    readinessLabelVi: 'Không trực',
    availabilityStatus: 'Off Shift',
  };
};

const getAvailability = async ({ role, date, floorId }) => {
  const now = new Date();
  const todayLocal = getLocalDateString(now);

  let checkDate;
  let checkDateLocal;
  if (date) {
    try {
      checkDate = parseWorkDate(date);
      checkDateLocal = date;
    } catch {
      throw new ServiceError('date must be YYYY-MM-DD', 400);
    }
  } else {
    checkDateLocal = todayLocal;
    checkDate = parseWorkDate(todayLocal);
  }

  const dayEnd = new Date(checkDate.getTime() + 24 * 60 * 60 * 1000 - 1);
  const isToday = checkDateLocal === todayLocal;

  const filter = { role: { $in: ['doctor', 'nurse'] }, isActive: true, isBanned: false };
  if (role) {
    if (!['doctor', 'nurse'].includes(role)) throw new ServiceError('role must be doctor or nurse', 400);
    filter.role = role;
  }

  const allStaff = await userRepo.findStaffUsers(filter, { skip: 0, limit: 1000 });
  const staffIds = allStaff.map((u) => u._id);

  const profiles = await staffProfileRepo.findByUserIdList(staffIds);
  const profileByUserId = Object.fromEntries(
    profiles.map((p) => [resolveUserIdFromProfile(p), p]).filter(([id]) => id)
  );

  let filteredStaff = allStaff;
  if (floorId) {
    const floorProfiles = await staffProfileRepo.findByAreaId(floorId);
    const floorUserIds = new Set(floorProfiles.map((p) => resolveUserIdFromProfile(p)).filter(Boolean));
    filteredStaff = allStaff.filter((u) => floorUserIds.has(u._id.toString()));
  }

  const onLeaveRecords = await leaveRequestRepo.findOverlappingApprovedByDate(checkDate, dayEnd);
  const onLeaveSet = new Set(
    onLeaveRecords.map((r) => (r.staffId?._id || r.staffId).toString())
  );

  const profileIds = profiles.map((p) => p._id);
  const profileIdToUserId = Object.fromEntries(
    profiles
      .map((p) => [p._id.toString(), resolveUserIdFromProfile(p)])
      .filter(([, uid]) => uid)
  );

  const shiftsOnDate = await shiftRepo.findShiftsByStaffIdsOnDate(profileIds, checkDate);

  const profilesWithShiftOnDate = new Set(
    shiftsOnDate.map((s) => (s.assignedStaffId?._id || s.assignedStaffId).toString())
  );

  const activeShifts = shiftsOnDate.filter((s) =>
    isShiftActiveForCheck(s.startTime, s.endTime, isToday, now)
  );

  const onShiftSet = new Set();
  for (const s of activeShifts) {
    const pid = (s.assignedStaffId?._id || s.assignedStaffId).toString();
    const uid = profileIdToUserId[pid];
    if (uid) onShiftSet.add(uid);
  }

  const shiftByProfileId = {};
  for (const s of activeShifts) {
    const pid = (s.assignedStaffId?._id || s.assignedStaffId).toString();
    if (pid && !shiftByProfileId[pid]) shiftByProfileId[pid] = s;
  }

  const activeTasksOnDate = await careTaskRepo.findActiveByStaffIdsOnDate(
    profileIds,
    checkDate,
    dayEnd
  );
  const busyProfileIdsOnDate = new Set(
    activeTasksOnDate.map((t) => t.staffProfileId.toString())
  );

  const summary = { ready: 0, caring: 0, offDuty: 0, onLeave: 0 };

  const result = filteredStaff.map((u) => {
    const uid = u._id.toString();
    const profile = profileByUserId[uid];
    const profileId = profile?._id?.toString();
    const onLeave = onLeaveSet.has(uid);
    const onShift = onShiftSet.has(uid);
    const hasShiftOnDate = profileId ? profilesWithShiftOnDate.has(profileId) : false;
    const hasActiveTasksOnDate = profileId ? busyProfileIdsOnDate.has(profileId) : false;
    const hasTasks = hasShiftOnDate && hasActiveTasksOnDate;
    const shiftDoc = profileId ? shiftByProfileId[profileId] || null : null;

    const { readinessLevel, readinessLabelVi, availabilityStatus } = classifyReadiness(
      onLeave,
      onShift,
      hasTasks
    );

    summary[readinessLevel === 'off_duty' ? 'offDuty' : readinessLevel === 'on_leave' ? 'onLeave' : readinessLevel] += 1;

    return formatAvailabilityStaffRow(
      u,
      profile,
      {
        availabilityStatus,
        readinessLevel,
        readinessLabelVi,
        isOnShift: onShift && !onLeave,
        onLeave,
        onShift,
        hasTasks,
      },
      { currentShift: formatCurrentShift(shiftDoc) }
    );
  });

  const PRIORITY = { ready: 0, caring: 1, off_duty: 2, on_leave: 3 };
  result.sort((a, b) => PRIORITY[a.readinessLevel] - PRIORITY[b.readinessLevel]);

  return {
    date: checkDate,
    checkedAt: isToday ? now : null,
    floorId: floorId || null,
    summary,
    data: result,
  };
};

// ── Area coverage status ─────────────────────────────────────────────────────

const getAreaCoverageStatus = async (floorId) => {
  if (!floorId) throw new ServiceError('floorId is required', 400);

  const now = new Date();
  const todayLocal = getLocalDateString(now);
  const dayStart = parseWorkDate(todayLocal);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

  const profiles = await staffProfileRepo.findByAreaId(floorId);
  if (!profiles.length) {
    return { floorId, coverage: 'noCoverage', totalAssigned: 0, activeToday: 0, staff: [] };
  }

  const profileIds = profiles.map((p) => p._id);
  const shifts = await shiftRepo.findByDateRange(dayStart, dayEnd, {
    assignedStaffId: { $in: profileIds },
    status: 'confirmed',
  });

  const activeProfileIds = new Set(
    shifts
      .filter((s) => isShiftActiveNow(s.startTime, s.endTime, now))
      .map((s) => s.assignedStaffId?._id?.toString())
      .filter(Boolean)
  );

  const onLeaveRecords = await leaveRequestRepo.findOverlappingApprovedByDate(dayStart, dayEnd);
  const onLeaveUserIds = new Set(
    onLeaveRecords.map((r) => (r.staffId?._id || r.staffId).toString())
  );

  const staffDetails = profiles.map((p) => {
    const userId = resolveUserIdFromProfile(p);
    const onLeave = onLeaveUserIds.has(userId);
    const onShift = activeProfileIds.has(p._id.toString());
    return {
      staffProfileId: p._id,
      userId: p.userId,
      onShift,
      onLeave,
    };
  });

  const activeToday = staffDetails.filter((s) => s.onShift && !s.onLeave).length;
  let coverage;
  if (activeToday === 0) coverage = 'noCoverage';
  else if (activeToday < profiles.length) coverage = 'understaffed';
  else coverage = 'fullyStaffed';

  return { floorId, coverage, totalAssigned: profiles.length, activeToday, staff: staffDetails };
};

module.exports = {
  listStaffProfiles,
  getStaffProfile,
  updateStaffProfile,
  updateStaffRole,
  banStaff,
  unbanStaff,
  assignAreas,
  assignResidents,
  listResidentsAvailableForStaff,
  listAssignedResidents,
  getAvailability,
  getAreaCoverageStatus,
};

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ServiceError = require('./serviceError');
const userRepo = require('../repositories/userRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const {
  validateFullName,
  validateEmail,
  validatePhone,
  validateUsername,
  validatePassword,
  validateDateOfBirth,
  collectErrors,
} = require('../utils/validators');
const cloudinary = require('../config/cloudinaryConfig');
const { getAuth, isFirebaseEnabled } = require('../config/firebaseAdmin');
const {
  assertActorMayCreateRole,
  assertActorMayManageUser,
  OPERATIONAL_ASSIGNABLE_ROLES,
} = require('../utils/rolePolicy');

const STAFF_ROLES = ['doctor', 'nurse', 'manager', 'staff', 'admin'];
const STAFF_CODE_PREFIXES = { doctor: 'DOC', nurse: 'NUR', manager: 'MGR', staff: 'STF', admin: 'ADM' };
const VALID_ROLES = [...STAFF_ROLES, 'admin'];

const generateStaffCode = (role) => {
  const prefix = STAFF_CODE_PREFIXES[role] || 'STF';
  return `${prefix}${Date.now().toString().slice(-6)}`;
};

const login = async ({ email, password }) => {
  if (!email || !password) {
    throw new ServiceError('Email and password are required', 400);
  }

  const user = await userRepo.findByEmail(email);
  if (!user) throw new ServiceError('Invalid credentials', 401);
  if (!user.isActive) throw new ServiceError('Account is inactive', 401);
  if (user.isBanned) throw new ServiceError('Account is banned', 401);

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) throw new ServiceError('Invalid credentials', 401);

  user.lastLoginAt = new Date();
  await userRepo.saveUser(user);

  const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

  return {
    token,
    user: {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
    },
  };
};

const getMe = async (user) => {
  const userData = {
    _id: user._id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    gender: user.gender,
    dateOfBirth: user.dateOfBirth,
    avatarUrl: user.avatarUrl,
    address: user.address,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };

  if (VALID_ROLES.includes(user.role)) {
    const staffProfile = await staffProfileRepo.findByUserId(user._id);
    userData.staffProfile = staffProfile || null;
  }

  return userData;
};

const listStaffAccounts = async ({ role, isActive, search, page = 1, limit = 20 }) => {
  const filter = { role: { $in: [...STAFF_ROLES, 'admin'] } };
  if (role) {
    if (![...STAFF_ROLES, 'admin'].includes(role)) {
      throw new ServiceError(`role must be one of: ${[...STAFF_ROLES, 'admin'].join(', ')}`, 400);
    }
    filter.role = role;
  }
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  if (search) {
    filter.$or = [
      { fullName: { $regex: search.trim(), $options: 'i' } },
      { email: { $regex: search.trim(), $options: 'i' } },
    ];
  }

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * limitNum;

  const [users, total] = await Promise.all([
    userRepo.findStaffUsers(filter, { skip, limit: limitNum }),
    userRepo.countStaffUsers(filter),
  ]);

  const userIds = users.map((u) => u._id);
  const staffProfiles = await staffProfileRepo.findByUserIds(userIds);
  const profileMap = Object.fromEntries(staffProfiles.map((p) => [p.userId.toString(), p]));

  const data = users.map((u) => ({
    ...u.toObject(),
    staffProfile: profileMap[u._id.toString()] || null,
  }));

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

const createStaffAccount = async (
  {
    fullName,
    email,
    password,
    role,
    phone,
    gender,
    dateOfBirth,
    address,
    specialty,
    staffCode,
    certifications,
    username,
    avatarUrl,
    avatarPublicId,
  },
  currentUser
) => {
  // Validation
  const validationError = collectErrors([
    () => validateFullName(fullName),
    () => validateEmail(email),
    () => validatePassword(password),
    () => validatePhone(phone),
    () => validateUsername(username),
    () => validateDateOfBirth(dateOfBirth),
  ]);
  if (validationError) throw new ServiceError(validationError, 400);

  if (!role) throw new ServiceError('role is required', 400);
  assertActorMayCreateRole(currentUser, role);
  const allowedRoles =
    currentUser?.role === 'manager' ? OPERATIONAL_ASSIGNABLE_ROLES : STAFF_ROLES;
  if (!allowedRoles.includes(role)) {
    throw new ServiceError(`role must be one of: ${allowedRoles.join(', ')}`, 400);
  }

  const existing = await userRepo.findByEmail(email);
  if (existing) throw new ServiceError('Email already in use', 409);

  if (username) {
    const existingUsername = await userRepo.findByUsername(username.trim());
    if (existingUsername) throw new ServiceError('Username already in use', 409);
  }

  const resolvedStaffCode = staffCode ? staffCode.toUpperCase().trim() : generateStaffCode(role);
  const codeConflict = await staffProfileRepo.findByStaffCode(resolvedStaffCode);
  if (codeConflict) {
    throw new ServiceError(`staffCode "${resolvedStaffCode}" already exists`, 409);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await userRepo.createUser({
    fullName: fullName.trim(),
    email: email.toLowerCase().trim(),
    username: username ? username.trim() : undefined,
    passwordHash,
    role,
    phone: phone?.trim(),
    gender: gender || 'unknown',
    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
    address: address?.trim(),
    avatarUrl: avatarUrl || undefined,
    avatarPublicId: avatarPublicId || undefined,
    isActive: true,
  });

  const staffProfile = await staffProfileRepo.createStaffProfile({
    userId: user._id,
    staffCode: resolvedStaffCode,
    roleCategory: role,
    specialty: specialty?.trim(),
    certifications: certifications || [],
  });

  return {
    message: 'Staff account created successfully',
    user: {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      username: user.username,
      role: user.role,
      avatarUrl: user.avatarUrl,
      isActive: user.isActive,
      createdAt: user.createdAt,
    },
    staffProfile: {
      _id: staffProfile._id,
      staffCode: staffProfile.staffCode,
      roleCategory: staffProfile.roleCategory,
      specialty: staffProfile.specialty,
    },
  };
};

const toggleStaffActive = async (id, currentUser) => {
  const user = await userRepo.findById(id).select('-passwordHash -resetPasswordTokenHash');
  if (!user) throw new ServiceError('User not found', 404);
  if (!['admin', ...STAFF_ROLES].includes(user.role)) {
    throw new ServiceError('Can only toggle staff accounts', 400);
  }
  assertActorMayManageUser(currentUser, user);
  if (user._id.toString() === currentUser._id.toString()) {
    throw new ServiceError('Cannot change your own active status', 400);
  }

  user.isActive = !user.isActive;
  await userRepo.saveUser(user);

  return {
    message: `Account ${user.isActive ? 'activated' : 'deactivated'} successfully`,
    user: { _id: user._id, fullName: user.fullName, email: user.email, role: user.role, isActive: user.isActive },
  };
};

const createFirebaseCustomToken = async (user) => {
  if (!isFirebaseEnabled()) {
    throw new ServiceError('Firebase Realtime Database is not configured on the server', 503);
  }

  const auth = getAuth();
  if (!auth) {
    throw new ServiceError('Firebase Realtime Database is not configured on the server', 503);
  }

  try {
    const firebaseToken = await auth.createCustomToken(user._id.toString(), {
      role: user.role,
    });

    return {
      firebaseToken,
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    };
  } catch (err) {
    console.error('[createFirebaseCustomToken]', err.code || err.name, err.message);
    throw new ServiceError(err.message || 'Failed to create Firebase custom token', 502);
  }
};

module.exports = {
  login,
  getMe,
  listStaffAccounts,
  createStaffAccount,
  toggleStaffActive,
  createFirebaseCustomToken,
};

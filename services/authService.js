const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ServiceError = require('./serviceError');
const userRepo = require('../repositories/userRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const mailService = require('./mailService');
const STAFF_ROLES = ['doctor', 'nurse', 'manager', 'staff', 'pharmacist'];
const STAFF_CODE_PREFIXES = { doctor: 'DOC', nurse: 'NUR', manager: 'MGR', staff: 'STF', pharmacist: 'PHA', admin: 'ADM' };
const VALID_ROLES = [...STAFF_ROLES, 'admin'];
const crypto = require('crypto');
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

const createStaffAccount = async ({
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
}) => {
  if (!fullName || !email || !password || !role) {
    throw new ServiceError('fullName, email, password and role are required', 400);
  }
  if (!STAFF_ROLES.includes(role)) {
    throw new ServiceError(`role must be one of: ${STAFF_ROLES.join(', ')}`, 400);
  }
  if (password.length < 6) {
    throw new ServiceError('password must be at least 6 characters', 400);
  }

  const existing = await userRepo.findByEmail(email);
  if (existing) throw new ServiceError('Email already in use', 409);

  const resolvedStaffCode = staffCode ? staffCode.toUpperCase().trim() : generateStaffCode(role);
  const codeConflict = await staffProfileRepo.findByStaffCode(resolvedStaffCode);
  if (codeConflict) {
    throw new ServiceError(`staffCode "${resolvedStaffCode}" already exists`, 409);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await userRepo.createUser({
    fullName: fullName.trim(),
    email: email.toLowerCase().trim(),
    passwordHash,
    role,
    phone: phone?.trim(),
    gender: gender || 'unknown',
    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
    address: address?.trim(),
    isActive: true,
  });

  const staffProfile = await staffProfileRepo.createStaffProfile({
    userId: user._id,
    staffCode: resolvedStaffCode,
    roleCategory: role,
    specialty: specialty?.trim(),
    certifications: certifications || [],
  });

  await mailService.sendStaffAccountCreatedEmail({
    to: user.email,
    fullName: user.fullName,
    role: user.role,
    staffCode: resolvedStaffCode,
    email: user.email,
    password,
  });

  return {
    message: 'Staff account created successfully',
    user: {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
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
// update profile
const updateProfile = async (user, data) => {
  return await userRepo.updateProfile(user._id, data);
};

// đổi pass
const changePassword = async (
  user,
  { currentPassword, newPassword }
) => {
  if (!currentPassword || !newPassword) {
    throw new ServiceError(
      'currentPassword and newPassword are required',
      400
    );
  }

  if (newPassword.length < 6) {
    throw new ServiceError(
      'New password must be at least 6 characters',
      400
    );
  }

  const dbUser = await userRepo.findById(user._id);

  const isMatch = await bcrypt.compare(
    currentPassword,
    dbUser.passwordHash
  );

  if (!isMatch) {
    throw new ServiceError(
      'Current password is incorrect',
      401
    );
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  dbUser.passwordHash = passwordHash;

  await userRepo.saveUser(dbUser);

  return {
    message: 'Password changed successfully',
  };
};
// quên mk
const forgotPassword = async ({ email }) => {
  const user = await userRepo.findByEmail(email);

  if (!user) {
    throw new ServiceError('Email not found', 404);
  }

  const resetToken = crypto
    .randomBytes(32)
    .toString('hex');

  const hashedToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  user.resetPasswordTokenHash = hashedToken;

  user.resetPasswordExpiresAt =
    Date.now() + 10 * 60 * 1000;

  await userRepo.saveUser(user);

  const resetUrl =
    `http://localhost:5173/reset-password?token=${resetToken}`;

  await mailService.sendResetPasswordEmail(
    user.email,
    resetUrl
  );

  return {
    message: 'Reset password email sent',
  };
};
//rs mk
const resetPassword = async ({
  token,
  newPassword,
}) => {
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  const user = await userRepo.findOne({
    resetPasswordTokenHash: hashedToken,
    resetPasswordExpiresAt: {
      $gt: Date.now(),
    },
  });

  if (!user) {
    throw new ServiceError(
      'Invalid or expired token',
      400
    );
  }

  user.passwordHash = await bcrypt.hash(
    newPassword,
    10
  );

  user.resetPasswordTokenHash = undefined;
  user.resetPasswordExpiresAt = undefined;

  await userRepo.saveUser(user);

  return {
    message: 'Password reset successfully',
  };
};
// update user by admin
const updateUserByAdmin = async (
  userId,
  data
) => {
  const user = await userRepo.findById(userId);

  if (!user) {
    throw new ServiceError(
      'User not found',
      404
    );
  }

  const allowedFields = [
    'fullName',
    'phone',
    'gender',
    'address',
    'role',
    'isActive',
    'isBanned',
    'banReason',
  ];

  allowedFields.forEach((field) => {
    if (data[field] !== undefined) {
      user[field] = data[field];
    }
  });

  await userRepo.saveUser(user);

  return {
    message: 'User updated successfully',
    user,
  };
};
module.exports = { login, getMe, listStaffAccounts, createStaffAccount, 
  toggleStaffActive, updateProfile, changePassword, forgotPassword, resetPassword, updateUserByAdmin };

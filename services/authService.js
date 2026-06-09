const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const ServiceError = require('./serviceError');
const userRepo = require('../repositories/userRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const mailService = require('./mailService');
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

const STAFF_ROLES = ['doctor', 'nurse', 'caregiver', 'chef', 'manager', 'staff', 'pharmacist'];
const ACCOUNT_CREATION_ROLES = [...STAFF_ROLES, 'family'];
const STAFF_CODE_PREFIXES = {
  doctor: 'DOC',
  nurse: 'NUR',
  caregiver: 'CAR',
  chef: 'CHE',
  manager: 'MGR',
  staff: 'STF',
  pharmacist: 'PHA',
  admin: 'ADM',
  family: 'FAM',
};
const VALID_STAFF_ROLES = [...STAFF_ROLES, 'admin'];
const VALID_ROLES = [...ACCOUNT_CREATION_ROLES, 'admin'];
const DEFAULT_SPECIALTY_BY_ROLE = {
  admin: 'Administration',
  manager: 'Operations Management',
  doctor: 'General Medicine',
  nurse: 'Care Nursing',
  caregiver: 'Daily Living Assistance',
  chef: 'Kitchen Management',
  pharmacist: 'Pharmacy',
  staff: 'General Support',
  family: 'Family Portal',
};

const generateStaffCode = (role) => {
  const prefix = STAFF_CODE_PREFIXES[role] || 'STF';
  return `${prefix}${Date.now().toString().slice(-6)}`;
};

const normalizeRole = (role) => String(role || '').trim().toLowerCase();

const buildFallbackStaffProfile = (user) => ({
  roleCategory: user.role,
  specialty: DEFAULT_SPECIALTY_BY_ROLE[user.role] || undefined,
});

const login = async ({ email, password }) => {
  if (!email || !password) {
    throw new ServiceError('Email và mật khẩu là bắt buộc', 400);
  }

  const user = await userRepo.findByEmail(email);
  if (!user) throw new ServiceError('Thông tin đăng nhập không hợp lệ', 401);
  if (!user.isActive) throw new ServiceError('Tài khoản đang bị vô hiệu hóa', 401);
  if (user.isBanned) throw new ServiceError('Tài khoản đang bị khóa', 401);

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) throw new ServiceError('Thông tin đăng nhập không hợp lệ', 401);

  user.lastLoginAt = new Date();
  await userRepo.saveUser(user);

  const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });

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

  if (VALID_STAFF_ROLES.includes(user.role)) {
    const staffProfile = await staffProfileRepo.findByUserId(user._id);
    userData.staffProfile = staffProfile || buildFallbackStaffProfile(user);
  }

  return userData;
};

const listStaffAccounts = async ({ role, isActive, search, page = 1, limit = 20 }) => {
  const filter = { role: { $in: [...STAFF_ROLES, 'admin'] } };
  if (role) {
    if (![...STAFF_ROLES, 'admin', 'family'].includes(role)) {
      throw new ServiceError(`role phải thuộc một trong: ${[...STAFF_ROLES, 'admin', 'family'].join(', ')}`, 400);
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
    staffProfile: profileMap[u._id.toString()] || buildFallbackStaffProfile(u),
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
    certificationDocuments,
    username,
    avatarUrl,
    avatarPublicId,
  },
  currentUser
) => {
  const validationError = collectErrors([
    () => validateFullName(fullName),
    () => validateEmail(email),
    () => validatePassword(password),
    () => validatePhone(phone),
    () => validateUsername(username),
    () => validateDateOfBirth(dateOfBirth),
  ]);
  if (validationError) throw new ServiceError(validationError, 400);

  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) throw new ServiceError('Thiếu trường role', 400);
  assertActorMayCreateRole(currentUser, normalizedRole);
  const allowedRoles = currentUser?.role === 'manager' ? OPERATIONAL_ASSIGNABLE_ROLES : ACCOUNT_CREATION_ROLES;
  if (!allowedRoles.includes(normalizedRole)) {
    throw new ServiceError(`role phải thuộc một trong: ${allowedRoles.join(', ')}`, 400);
  }

  const existing = await userRepo.findByEmail(email);
  if (existing) throw new ServiceError('Email đã được sử dụng', 409);

  if (username) {
    const existingUsername = await userRepo.findByUsername(username.trim());
    if (existingUsername) throw new ServiceError('Tên đăng nhập đã được sử dụng', 409);
  }

  const resolvedStaffCode = normalizedRole !== 'family'
    ? staffCode
      ? staffCode.toUpperCase().trim()
      : generateStaffCode(normalizedRole)
    : undefined;

  if (resolvedStaffCode) {
    const codeConflict = await staffProfileRepo.findByStaffCode(resolvedStaffCode);
    if (codeConflict) {
      throw new ServiceError(`staffCode "${resolvedStaffCode}" đã tồn tại`, 409);
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await userRepo.createUser({
    fullName: fullName.trim(),
    email: email.toLowerCase().trim(),
    username: username ? username.trim() : undefined,
    passwordHash,
    role: normalizedRole,
    phone: phone?.trim(),
    gender: gender || 'unknown',
    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
    address: address?.trim(),
    avatarUrl: avatarUrl || undefined,
    avatarPublicId: avatarPublicId || undefined,
    isActive: true,
  });

  const parsedCertificationDocuments = (() => {
    if (!certificationDocuments) return [];
    if (typeof certificationDocuments === 'string') {
      try {
        return JSON.parse(certificationDocuments);
      } catch {
        return [];
      }
    }
    return Array.isArray(certificationDocuments) ? certificationDocuments : [];
  })();

  let staffProfile;
  if (normalizedRole !== 'family') {
    staffProfile = await staffProfileRepo.createStaffProfile({
      userId: user._id,
      staffCode: resolvedStaffCode,
      roleCategory: normalizedRole,
      specialty: specialty?.trim() || DEFAULT_SPECIALTY_BY_ROLE[normalizedRole],
      certifications: certifications || [],
      certificationDocuments: parsedCertificationDocuments,
    });
  }

  await mailService.sendStaffAccountCreatedEmail({
    to: user.email,
    fullName: user.fullName,
    role: user.role,
    staffCode: resolvedStaffCode,
    email: user.email,
    password,
  });

  return {
    message: 'Tạo tài khoản nhân viên thành công',
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
    staffProfile: staffProfile
      ? {
          _id: staffProfile._id,
          staffCode: staffProfile.staffCode,
          roleCategory: staffProfile.roleCategory,
          specialty: staffProfile.specialty,
        }
      : undefined,
  };
};

const toggleStaffActive = async (id, currentUser) => {
  const user = await userRepo.findById(id);
  if (!user) throw new ServiceError('Không tìm thấy người dùng', 404);
  if (!['admin', ...STAFF_ROLES].includes(user.role)) {
    throw new ServiceError('Chỉ có thể thay đổi trạng thái tài khoản nhân viên', 400);
  }
  assertActorMayManageUser(currentUser, user);
  if (user._id.toString() === currentUser._id.toString()) {
    throw new ServiceError('Không thể tự thay đổi trạng thái hoạt động của chính bạn', 400);
  }

  user.isActive = !user.isActive;
  await userRepo.saveUser(user);

  return {
    message: `Account ${user.isActive ? 'activated' : 'deactivated'} successfully`,
    user: {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    },
  };
};

const updateProfile = async (user, data) => {
  return userRepo.updateProfile(user._id, data);
};

const changePassword = async (user, { currentPassword, newPassword }) => {
  if (!currentPassword || !newPassword) {
    throw new ServiceError('currentPassword và newPassword là bắt buộc', 400);
  }

  if (newPassword.length < 6) {
    throw new ServiceError('Mật khẩu mới phải có ít nhất 6 ký tự', 400);
  }

  const dbUser = await userRepo.findById(user._id);
  const isMatch = await bcrypt.compare(currentPassword, dbUser.passwordHash);
  if (!isMatch) {
    throw new ServiceError('Mật khẩu hiện tại không đúng', 401);
  }

  dbUser.passwordHash = await bcrypt.hash(newPassword, 10);
  await userRepo.saveUser(dbUser);

  return { message: 'Đổi mật khẩu thành công' };
};

const forgotPassword = async ({ email }) => {
  const user = await userRepo.findByEmail(email);
  if (!user) throw new ServiceError('Không tìm thấy email', 404);

  const resetToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

  user.resetPasswordTokenHash = hashedToken;
  user.resetPasswordExpiresAt = Date.now() + 10 * 60 * 1000;
  await userRepo.saveUser(user);

  const resetUrl = `http://localhost:5173/reset-password?token=${resetToken}`;
  await mailService.sendResetPasswordEmail(user.email, resetUrl);

  return { message: 'Đã gửi email đặt lại mật khẩu' };
};

const resetPassword = async ({ token, newPassword }) => {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await userRepo.findOne({
    resetPasswordTokenHash: hashedToken,
    resetPasswordExpiresAt: { $gt: Date.now() },
  });

  if (!user) throw new ServiceError('Token không hợp lệ hoặc đã hết hạn', 400);

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.resetPasswordTokenHash = undefined;
  user.resetPasswordExpiresAt = undefined;
  await userRepo.saveUser(user);

  return { message: 'Đặt lại mật khẩu thành công' };
};

const updateUserByAdmin = async (userId, data) => {
  const user = await userRepo.findById(userId);
  if (!user) throw new ServiceError('Không tìm thấy người dùng', 404);

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
    message: 'Cập nhật người dùng thành công',
    user,
  };
};

const createFirebaseCustomToken = async (user) => {
  if (!isFirebaseEnabled()) {
    throw new ServiceError('Firebase Realtime Database chưa được cấu hình trên server', 503);
  }

  const auth = getAuth();
  if (!auth) {
    throw new ServiceError('Firebase Realtime Database chưa được cấu hình trên server', 503);
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
    throw new ServiceError(err.message || 'Tạo Firebase custom token thất bại', 502);
  }
};

module.exports = {
  login,
  getMe,
  listStaffAccounts,
  createStaffAccount,
  toggleStaffActive,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  updateUserByAdmin,
  createFirebaseCustomToken,
};

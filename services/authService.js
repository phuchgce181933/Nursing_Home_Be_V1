const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { apiErr, apiSuccess, CODES, SUCCESS } = require('../utils/apiError');
const userRepo = require('../repositories/userRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const mailService = require('./mailService');
const otpService = require('./otpService');
const { validatePhone, validateUsername, validateDateOfBirth, validateFullName, validateEmail, validatePassword, collectErrors } = require('../utils/validators');
const STAFF_ROLES = ['doctor', 'nurse', 'pharmacist', 'caregiver'];
const STAFF_CODE_PREFIXES = { doctor: 'DOC', nurse: 'NUR', pharmacist: 'PHA', caregiver: 'CAR', admin: 'ADM' };
const VALID_ROLES = [...STAFF_ROLES, 'admin', 'system'];
const crypto = require('crypto');
const generateStaffCode = (role) => {
  const prefix = STAFF_CODE_PREFIXES[role] || 'STF';
  return `${prefix}${Date.now().toString().slice(-6)}`;
};

const login = async ({ email, password }) => {
  if (!email || !password) {
    throw apiErr(CODES.AUTH_CREDENTIALS_REQUIRED, { statusCode: 400 });
  }

  const identifier = String(email).trim();
  const user = identifier.includes('@')
    ? await userRepo.findByEmail(identifier)
    : await userRepo.findOne({ phone: identifier });
  if (!user) throw apiErr(CODES.AUTH_INVALID_CREDENTIALS, { statusCode: 401 });
  if (!user.isActive) throw apiErr(CODES.AUTH_ACCOUNT_INACTIVE, { statusCode: 401 });
  if (user.isBanned) throw apiErr(CODES.AUTH_ACCOUNT_BANNED, { statusCode: 401 });

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) throw apiErr(CODES.AUTH_INVALID_CREDENTIALS, { statusCode: 401 });

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
      throw apiErr(CODES.AUTH_ROLE_INVALID, {
        statusCode: 400,
        params: { allowed: [...STAFF_ROLES, 'admin'].join(', ') },
      });
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
  username,
  avatarUrl,
  avatarPublicId,
  certificationDocuments,
}, currentUser) => {
  if (!fullName || !email || !password || !role) {
    throw apiErr(CODES.AUTH_CREATE_STAFF_REQUIRED, { statusCode: 400 });
  }
  if (!STAFF_ROLES.includes(role)) {
    throw apiErr(CODES.AUTH_ROLE_INVALID, {
      statusCode: 400,
      params: { allowed: STAFF_ROLES.join(', ') },
    });
  }
  if (password.length < 6) {
    throw apiErr(CODES.AUTH_PASSWORD_TOO_SHORT, { statusCode: 400, params: { min: 6 } });
  }

  const phoneError = validatePhone(phone);
  if (phoneError) throw apiErr(CODES.AUTH_VALIDATION_FAILED, { statusCode: 400, params: { detail: phoneError } });

  const usernameError = validateUsername(username);
  if (usernameError) throw apiErr(CODES.AUTH_VALIDATION_FAILED, { statusCode: 400, params: { detail: usernameError } });

  const dobError = validateDateOfBirth(dateOfBirth);
  if (dobError) throw apiErr(CODES.AUTH_VALIDATION_FAILED, { statusCode: 400, params: { detail: dobError } });

  const existing = await userRepo.findByEmail(email);
  if (existing) throw apiErr(CODES.AUTH_EMAIL_IN_USE, { statusCode: 409 });

  let normalizedPhone;
  if (phone?.trim()) {
    normalizedPhone = phone.trim();
    const phoneConflict = await userRepo.findOne({ phone: normalizedPhone });
    if (phoneConflict) throw apiErr(CODES.AUTH_PHONE_IN_USE, { statusCode: 409 });
  }

  if (username?.trim()) {
    const usernameConflict = await userRepo.findByUsername(username.trim());
    if (usernameConflict) throw apiErr(CODES.AUTH_USERNAME_IN_USE, { statusCode: 409 });
  }

  const resolvedStaffCode = staffCode ? staffCode.toUpperCase().trim() : generateStaffCode(role);
  const codeConflict = await staffProfileRepo.findByStaffCode(resolvedStaffCode);
  if (codeConflict) {
    throw apiErr(CODES.AUTH_STAFF_CODE_EXISTS, {
      statusCode: 409,
      params: { code: resolvedStaffCode },
    });
  }

  const docs = Array.isArray(certificationDocuments) ? certificationDocuments : [];
  const certNamesFromDocs = docs.map((d) => d.fileName).filter(Boolean);
  const certList = certifications?.length ? certifications : certNamesFromDocs;

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await userRepo.createUser({
    fullName: fullName.trim(),
    email: email.toLowerCase().trim(),
    passwordHash,
    role,
    phone: normalizedPhone,
    username: username?.trim() || undefined,
    avatarUrl: avatarUrl || undefined,
    avatarPublicId: avatarPublicId || undefined,
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
    certifications: certList,
    certificationDocuments: docs,
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
    ...apiSuccess(SUCCESS.AUTH_STAFF_CREATED),
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

const requestRegisterOtp = async ({ fullName, email, phone, password }) => {
  const hasEmail = !!email?.trim();
  const hasPhone = !!phone?.trim();
  if (hasEmail === hasPhone) {
    // both provided or neither provided
    throw apiErr(CODES.AUTH_REGISTER_CONTACT_REQUIRED, { statusCode: 400 });
  }

  const fieldErrors = collectErrors([
    () => validateFullName(fullName),
    () => validatePassword(password),
    () => (hasEmail ? validateEmail(email) : null),
    () => (hasPhone ? validatePhone(phone) : null),
  ]);
  if (fieldErrors) throw apiErr(CODES.AUTH_VALIDATION_FAILED, { statusCode: 400, params: { detail: fieldErrors } });

  let normalizedEmail;
  if (hasEmail) {
    normalizedEmail = email.toLowerCase().trim();
    const existing = await userRepo.findByEmail(normalizedEmail);
    if (existing) throw apiErr(CODES.AUTH_EMAIL_IN_USE, { statusCode: 409 });
  }

  let normalizedPhone;
  if (hasPhone) {
    normalizedPhone = phone.trim();
    const phoneConflict = await userRepo.findOne({ phone: normalizedPhone });
    if (phoneConflict) throw apiErr(CODES.AUTH_PHONE_IN_USE, { statusCode: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const recipient = normalizedEmail || normalizedPhone;

  const { otpId, maskedRecipient } = await otpService.createOtp({
    userId: undefined,
    phone: recipient,
    purpose: 'register_family',
    meta: {
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      passwordHash,
    },
  });

  return { otpId, maskedRecipient };
};

const verifyRegisterOtp = async ({ otpId, code }) => {
  if (!otpId || !code) {
    throw apiErr(CODES.AUTH_OTP_REQUIRED, { statusCode: 400 });
  }

  const { meta } = await otpService.verifyOtp({
    userId: undefined,
    otpId,
    code,
    purpose: 'register_family',
  });

  if (!meta?.fullName || !meta?.passwordHash) {
    throw apiErr(CODES.AUTH_OTP_METADATA_INVALID, { statusCode: 400 });
  }

  if (meta.email) {
    const existing = await userRepo.findByEmail(meta.email);
    if (existing) throw apiErr(CODES.AUTH_EMAIL_IN_USE, { statusCode: 409 });
  }
  if (meta.phone) {
    const phoneConflict = await userRepo.findOne({ phone: meta.phone });
    if (phoneConflict) throw apiErr(CODES.AUTH_PHONE_IN_USE, { statusCode: 409 });
  }

  const user = await userRepo.createUser({
    fullName: meta.fullName,
    email: meta.email || undefined,
    phone: meta.phone || undefined,
    passwordHash: meta.passwordHash,
    role: 'family',
    isActive: true,
  });

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

const toggleStaffActive = async (id, currentUser) => {
  const user = await userRepo.findById(id).select('-passwordHash -resetPasswordTokenHash');
  if (!user) throw apiErr(CODES.AUTH_USER_NOT_FOUND, { statusCode: 404 });
  if (!['admin', ...STAFF_ROLES].includes(user.role)) {
    throw apiErr(CODES.AUTH_TOGGLE_STAFF_ONLY, { statusCode: 400 });
  }
  if (user._id.toString() === currentUser._id.toString()) {
    throw apiErr(CODES.AUTH_CANNOT_TOGGLE_SELF, { statusCode: 400 });
  }

  user.isActive = !user.isActive;
  await userRepo.saveUser(user);

  return {
    ...apiSuccess(user.isActive ? SUCCESS.AUTH_ACCOUNT_ACTIVATED : SUCCESS.AUTH_ACCOUNT_DEACTIVATED),
    user: { _id: user._id, fullName: user.fullName, email: user.email, role: user.role, isActive: user.isActive },
  };
};
const requestEmailChangeOtp = async (user, { email }) => {
  if (!email) {
    throw apiErr(CODES.AUTH_EMAIL_REQUIRED, { statusCode: 400 });
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  if (normalizedEmail === user.email) {
    throw apiErr(CODES.AUTH_EMAIL_ALREADY_CURRENT, { statusCode: 400 });
  }

  const existingUser = await userRepo.findOne({ email: normalizedEmail });
  if (existingUser && existingUser._id.toString() !== user._id.toString()) {
    throw apiErr(CODES.AUTH_EMAIL_IN_USE, { statusCode: 400 });
  }

  const { otpId, maskedRecipient } = await otpService.createOtp({
    userId: user._id,
    phone: normalizedEmail,
    purpose: 'verify_email_change',
    meta: { newEmail: normalizedEmail },
  });

  return { otpId, maskedRecipient };
};

const requestPhoneChangeOtp = async (user, { phone }) => {
  if (!phone) {
    throw apiErr(CODES.AUTH_PHONE_REQUIRED, { statusCode: 400 });
  }

  const normalizedPhone = String(phone).trim();
  const currentPhone = String(user?.phone || '').trim();

  if (normalizedPhone === currentPhone) {
    throw apiErr(CODES.AUTH_PHONE_ALREADY_CURRENT, { statusCode: 400 });
  }

  const existingUser = await userRepo.findOne({ phone: normalizedPhone });
  if (existingUser && existingUser._id.toString() !== user._id.toString()) {
    throw apiErr(CODES.AUTH_PHONE_IN_USE, { statusCode: 400 });
  }

  console.log(`[OTP] requestPhoneChangeOtp -> sending to new phone: ${normalizedPhone}`);

  const { otpId, maskedRecipient } = await otpService.createOtp({
    userId: user._id,
    phone: normalizedPhone,
    purpose: 'verify_phone_change',
    meta: { newPhone: normalizedPhone },
  });

  return { otpId, maskedRecipient };
};

const verifyPhoneChangeOtp = async (user, { otpId, code }) => {
  if (!otpId || !code) {
    throw apiErr(CODES.AUTH_OTP_REQUIRED, { statusCode: 400 });
  }

  const { meta } = await otpService.verifyOtp({
    userId: user._id,
    otpId,
    code,
    purpose: 'verify_phone_change',
  });

  if (!meta?.newPhone) {
    throw apiErr(CODES.AUTH_OTP_METADATA_INVALID, { statusCode: 400 });
  }

  const normalizedPhone = String(meta.newPhone).trim();
  const existingUser = await userRepo.findOne({ phone: normalizedPhone });
  if (existingUser && existingUser._id.toString() !== user._id.toString()) {
    throw apiErr(CODES.AUTH_PHONE_IN_USE, { statusCode: 400 });
  }

  return await userRepo.updateProfile(user._id, { phone: normalizedPhone });
};

const verifyEmailChangeOtp = async (user, { otpId, code }) => {
  if (!otpId || !code) {
    throw apiErr(CODES.AUTH_OTP_REQUIRED, { statusCode: 400 });
  }

  const { meta } = await otpService.verifyOtp({
    userId: user._id,
    otpId,
    code,
    purpose: 'verify_email_change',
  });

  if (!meta?.newEmail) {
    throw apiErr(CODES.AUTH_OTP_METADATA_INVALID, { statusCode: 400 });
  }

  const normalizedEmail = String(meta.newEmail).toLowerCase().trim();
  const existingUser = await userRepo.findOne({ email: normalizedEmail });
  if (existingUser && existingUser._id.toString() !== user._id.toString()) {
    throw apiErr(CODES.AUTH_EMAIL_IN_USE, { statusCode: 400 });
  }

  return await userRepo.updateProfile(user._id, { email: normalizedEmail });
};

// update profile
const updateProfile = async (user, data) => {
  if (data.email) {
    throw apiErr(CODES.AUTH_EMAIL_OTP_REQUIRED, { statusCode: 400 });
  }

  if (data.phone) {
    const normalizedPhone = data.phone.trim();
    const existingUser = await userRepo.findOne({ phone: normalizedPhone });
    if (existingUser && existingUser._id.toString() !== user._id.toString()) {
      throw apiErr(CODES.AUTH_PHONE_IN_USE, { statusCode: 400 });
    }
    data.phone = normalizedPhone;
  }

  return await userRepo.updateProfile(user._id, data);
};

// đổi pass
const changePassword = async (
  user,
  { currentPassword, newPassword }
) => {
  if (!currentPassword || !newPassword) {
    throw apiErr(CODES.AUTH_PASSWORD_REQUIRED, { statusCode: 400 });
  }

  if (newPassword.length < 6) {
    throw apiErr(CODES.AUTH_NEW_PASSWORD_TOO_SHORT, { statusCode: 400, params: { min: 6 } });
  }

  const dbUser = await userRepo.findById(user._id);

  const isMatch = await bcrypt.compare(
    currentPassword,
    dbUser.passwordHash
  );

  if (!isMatch) {
    throw apiErr(CODES.AUTH_CURRENT_PASSWORD_INCORRECT, { statusCode: 401 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  dbUser.passwordHash = passwordHash;

  await userRepo.saveUser(dbUser);

  return apiSuccess(SUCCESS.AUTH_PASSWORD_CHANGED);
};
// quên mk
const forgotPassword = async ({ email }) => {
  const user = await userRepo.findByEmail(email);

  if (!user) {
    throw apiErr(CODES.AUTH_EMAIL_NOT_FOUND, { statusCode: 404 });
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

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

  await mailService.sendResetPasswordEmail(
    user.email,
    resetUrl
  );

  return apiSuccess(SUCCESS.AUTH_RESET_EMAIL_SENT);
};
//rs mk
const resetPassword = async ({
  token,
  newPassword,
}) => {
  if (!token) {
    throw apiErr(CODES.AUTH_TOKEN_REQUIRED, { statusCode: 400 });
  }
  if (!newPassword || newPassword.length < 6) {
    throw apiErr(CODES.AUTH_NEW_PASSWORD_TOO_SHORT, { statusCode: 400, params: { min: 6 } });
  }

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
    throw apiErr(CODES.AUTH_TOKEN_INVALID, { statusCode: 400 });
  }

  user.passwordHash = await bcrypt.hash(
    newPassword,
    10
  );

  user.resetPasswordTokenHash = undefined;
  user.resetPasswordExpiresAt = undefined;

  await userRepo.saveUser(user);

  return apiSuccess(SUCCESS.AUTH_PASSWORD_RESET);
};
// update user by admin
const updateUserByAdmin = async (
  userId,
  data,
  currentUser
) => {
  const user = await userRepo.findById(userId);

  if (!user) {
    throw apiErr(CODES.AUTH_USER_NOT_FOUND, { statusCode: 404 });
  }

  if (currentUser && String(user._id) === String(currentUser._id)) {
    if (data.isActive === false || data.isBanned === true) {
      throw apiErr(CODES.AUTH_CANNOT_SELF_BAN, { statusCode: 400 });
    }
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

  if (data.role !== undefined && !VALID_ROLES.includes(data.role)) {
    throw apiErr(CODES.AUTH_ROLE_INVALID, {
      statusCode: 400,
      params: { allowed: VALID_ROLES.join(', ') },
    });
  }

  if (data.phone !== undefined && data.phone) {
    const phoneError = validatePhone(data.phone);
    if (phoneError) throw apiErr(CODES.AUTH_VALIDATION_FAILED, { statusCode: 400, params: { detail: phoneError } });

    const normalizedPhone = String(data.phone).trim();
    const existingPhoneUser = await userRepo.findOne({ phone: normalizedPhone });
    if (existingPhoneUser && existingPhoneUser._id.toString() !== user._id.toString()) {
      throw apiErr(CODES.AUTH_PHONE_IN_USE, { statusCode: 409 });
    }
    data.phone = normalizedPhone;
  }

  allowedFields.forEach((field) => {
    if (data[field] !== undefined) {
      user[field] = data[field];
    }
  });

  await userRepo.saveUser(user);

  return {
    ...apiSuccess(SUCCESS.AUTH_USER_UPDATED),
    user,
  };
};
const createFirebaseCustomToken = async (user) => {
  const { getAuth } = require('../config/firebaseAdmin');
  const auth = getAuth();
  if (!auth) {
    throw apiErr(CODES.AUTH_FIREBASE_NOT_CONFIGURED, { statusCode: 503 });
  }
  const token = await auth.createCustomToken(user._id.toString(), { role: user.role });
  return { firebaseToken: token };
};

module.exports = { login, getMe, listStaffAccounts, createStaffAccount, requestRegisterOtp, verifyRegisterOtp,
  toggleStaffActive,
  requestEmailChangeOtp,
  requestPhoneChangeOtp,
  verifyEmailChangeOtp,
  verifyPhoneChangeOtp,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  updateUserByAdmin,
  createFirebaseCustomToken };

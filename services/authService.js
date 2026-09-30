const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { apiErr, apiSuccess, CODES, SUCCESS } = require('../utils/apiError');
const userRepo = require('../repositories/userRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const mailService = require('./mailService');
const otpService = require('./otpService');
const { createAuditLog } = require('../utils/auditLog');
const { validatePhone, validateUsername, validateStaffDateOfBirth, validateStaffCertifications, validateFullName, validateEmail, validatePassword, collectErrors } = require('../utils/validators');
const STAFF_ROLES = ['doctor', 'nurse', 'pharmacist', 'caregiver', 'family'];
const STAFF_CODE_PREFIXES = { doctor: 'DOC', nurse: 'NUR', pharmacist: 'PHA', caregiver: 'CAR', admin: 'ADM', family: 'FAM' };
const VALID_ROLES = [...STAFF_ROLES, 'admin'];
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

// Lightweight search used by admin UIs to link a family account to a resident
// without staff needing to know/paste the account's raw Mongo ID.
const searchFamilyAccounts = async ({ search, limit = 20 }) => {
  const filter = { role: 'family' };
  const trimmed = String(search || '').trim();
  if (trimmed) {
    filter.$or = [
      { fullName: { $regex: trimmed, $options: 'i' } },
      { email: { $regex: trimmed, $options: 'i' } },
      { phone: { $regex: trimmed, $options: 'i' } },
    ];
  }
  const limitNum = Math.min(20, Math.max(1, parseInt(limit, 10) || 20));
  const users = await userRepo.findStaffUsers(filter, { skip: 0, limit: limitNum });
  return {
    data: users.map((u) => ({ _id: u._id, fullName: u.fullName, email: u.email, phone: u.phone })),
  };
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
  residentName,
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

  const dobError = validateStaffDateOfBirth(dateOfBirth, { role, gender });
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

  // Family accounts don't need a StaffProfile or staffCode; skip those validations and steps below.
  const isFamilyRole = role === 'family';

  let resolvedStaffCode;
  if (isFamilyRole) {
    resolvedStaffCode = undefined;
  } else {
    resolvedStaffCode = staffCode ? staffCode.toUpperCase().trim() : generateStaffCode(role);
    const codeConflict = await staffProfileRepo.findByStaffCode(resolvedStaffCode);
    if (codeConflict) {
      throw apiErr(CODES.AUTH_STAFF_CODE_EXISTS, {
        statusCode: 409,
        params: { code: resolvedStaffCode },
      });
    }
  }

  const docs = Array.isArray(certificationDocuments) ? certificationDocuments : [];
  const certError = isFamilyRole ? null : validateStaffCertifications(role, docs);
  if (certError) throw apiErr(CODES.AUTH_VALIDATION_FAILED, { statusCode: 400, params: { detail: certError } });

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

  let staffProfile = null;
  if (!isFamilyRole) {
    staffProfile = await staffProfileRepo.createStaffProfile({
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
  } else {
    await mailService.sendFamilyAccountCreatedEmail({
      to: user.email,
      fullName: user.fullName,
      residentName: residentName?.trim(),
      email: user.email,
      password,
    });
  }

  await createAuditLog({
    actorUserId: currentUser?._id,
    actorRole: currentUser?.role,
    action: 'CREATE_STAFF_ACCOUNT',
    displayAction: 'Tạo tài khoản nhân viên',
    module: 'auth',
    businessModule: 'auth',
    targetEntityType: 'User',
    targetEntityId: user._id.toString(),
    targetName: user.fullName,
    description: `Tạo tài khoản nhân viên ${role} cho ${user.fullName} (${user.email})`,
    beforeData: null,
    afterData: {
      _id: user._id.toString(),
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      phone: user.phone,
      isActive: user.isActive,
      staffProfile: staffProfile
        ? { staffCode: staffProfile.staffCode, specialty: staffProfile.specialty }
        : null,
    },
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
    staffProfile: staffProfile
      ? {
          _id: staffProfile._id,
          staffCode: staffProfile.staffCode,
          roleCategory: staffProfile.roleCategory,
          specialty: staffProfile.specialty,
        }
      : null,
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

  await createAuditLog({
    actorUserId: currentUser?._id,
    actorRole: currentUser?.role,
    action: 'TOGGLE_STAFF_ACTIVE',
    displayAction: user.isActive ? 'Kích hoạt tài khoản' : 'Vô hiệu hóa tài khoản',
    module: 'auth',
    businessModule: 'auth',
    targetEntityType: 'User',
    targetEntityId: user._id.toString(),
    targetName: user.fullName,
    description: `${user.isActive ? 'Kích hoạt' : 'Vô hiệu hóa'} tài khoản ${user.role} của ${user.fullName} (${user.email})`,
    beforeData: { isActive: !user.isActive },
    afterData: { isActive: user.isActive },
  });

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

  // Chỉ log số đã che — không ghi số điện thoại đầy đủ vào log ứng dụng.
  console.log(`[OTP] requestPhoneChangeOtp -> gửi tới ${normalizedPhone.replace(/.(?=.{4})/g, '*')}`);

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
const updateProfile = async (user, data, req) => {
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

  const beforeUser = await userRepo.findById(user._id);
  const beforeData = {
    fullName: beforeUser.fullName,
    phone: beforeUser.phone,
    gender: beforeUser.gender,
    address: beforeUser.address,
    dateOfBirth: beforeUser.dateOfBirth,
    avatarUrl: beforeUser.avatarUrl,
  };

  const result = await userRepo.updateProfile(user._id, data);
  const afterData = { ...beforeData, ...data };

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'UPDATE_PROFILE',
    displayAction: 'Cập nhật hồ sơ cá nhân',
    module: 'auth',
    businessModule: 'auth',
    targetEntityType: 'User',
    targetEntityId: user._id.toString(),
    targetName: user.fullName,
    description: `${user.fullName} cập nhật hồ sơ cá nhân`,
    beforeData,
    afterData,
    req,
  });

  return result;
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

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'CHANGE_PASSWORD',
    displayAction: 'Đổi mật khẩu',
    module: 'auth',
    businessModule: 'auth',
    targetEntityType: 'User',
    targetEntityId: user._id.toString(),
    targetName: user.fullName,
    description: `${user.fullName} đã đổi mật khẩu`,
    beforeData: { passwordChanged: false },
    afterData: { passwordChanged: true },
  });

  return apiSuccess(SUCCESS.AUTH_PASSWORD_CHANGED);
};
/**
 * Thời hạn của credential đặt lại mật khẩu, tính bằng phút. Đặt ở MỘT chỗ duy
 * nhất cho cả hai loại client: vừa dùng để tính `resetPasswordExpiresAt` (Web),
 * vừa là `expiresMinutes` của mã OTP (Mobile), vừa truyền xuống email — nên câu
 * "hết hạn sau N phút" trong email luôn đúng với hành vi kiểm tra thật.
 */
const RESET_TOKEN_TTL_MINUTES = 10;

/**
 * Hai loại client được phép yêu cầu đặt lại mật khẩu. Nguồn client là một TRƯỜNG
 * TƯỜNG MINH trong body, KHÔNG suy diễn từ User-Agent / header / hostname: cùng
 * một trình duyệt có thể là WebView trong app, và User-Agent thì client nào cũng
 * giả được — suy diễn sẽ khiến người dùng nhận sai loại email.
 */
const RESET_CLIENTS = ['web', 'mobile'];

/**
 * Chuẩn hoá + kiểm tra `client` ở phía server.
 *
 * Mặc định 'web' cho tương thích ngược: Web bản cũ (và các script/integration đã
 * tồn tại) gửi body chỉ có `email`. Mặc định này an toàn vì 'web' đúng là hành vi
 * duy nhất tồn tại trước đây — không mở thêm quyền gì, không đổi credential, chỉ
 * giữ nguyên luồng cũ. Giá trị lạ thì TỪ CHỐI thẳng thay vì âm thầm coi là 'web'.
 */
const normalizeResetClient = (client) => {
  if (client === undefined || client === null || client === '') return 'web';
  const value = String(client).toLowerCase().trim();
  if (!RESET_CLIENTS.includes(value)) {
    throw apiErr(CODES.AUTH_RESET_CLIENT_INVALID, { statusCode: 400 });
  }
  return value;
};

/**
 * Phát credential Web: token ngẫu nhiên 32 byte (64 hex), chỉ lưu bản băm SHA-256
 * trên document User. Trả về token gốc để dựng liên kết — token gốc không được
 * lưu ở đâu và không được log.
 */
const issueWebResetToken = async (user) => {
  const resetToken = crypto
    .randomBytes(32)
    .toString('hex');

  const hashedToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  user.resetPasswordTokenHash = hashedToken;
  user.resetPasswordExpiresAt = Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000;
  await userRepo.saveUser(user);

  return resetToken;
};

// quên mk
const forgotPassword = async ({ email, client }) => {
  // Validate định dạng email ngay tại backend — khớp với regex frontend:
  // ^[^\s@]+@[^\s@]+\.[^\s@]{2,}$. Trả messageKey AUTH_INVALID_EMAIL đã có sẵn trong
  // bộ CODES. Luôn trả về message thân thiện, không leak thông tin.
  const validationError = validateEmail(email);
  if (validationError) {
    throw apiErr(CODES.AUTH_INVALID_EMAIL, { statusCode: 400 });
  }

  // Kiểm tra `client` TRƯỚC khi tra cứu email: lỗi sai tham số phải giống nhau dù
  // email có tồn tại hay không.
  const resetClient = normalizeResetClient(client);

  const user = await userRepo.findByEmail(email);

  // Always respond the same way whether or not the email exists, so callers
  // can't use this endpoint to enumerate registered accounts.
  // Lưu ý: nếu email sai định dạng, ta đã throw ở trên — nếu email hợp lệ nhưng
  // không tồn tại, vẫn trả success để tránh account-enumeration.
  if (user) {
    // Chọn credential + mẫu email theo client. Đây là CHỖ DUY NHẤT phân nhánh
    // theo client; các tầng dưới (otpService, mailService) không biết gì về nó.
    if (resetClient === 'mobile') {
      // Mã 6 số qua hạ tầng OTP đang dùng: crypto.randomInt, HMAC-SHA256 khi lưu,
      // buộc theo userId + purpose, hết hạn, dùng một lần, tối đa 5 lần nhập sai,
      // cooldown gửi lại 30s. `purpose` riêng nên mã này không dùng được cho ví.
      // KHÔNG trả `otpId` ra ngoài: trả về sẽ tiết lộ email có tồn tại hay không.
      try {
        await otpService.createOtp({
          userId: user._id,
          phone: user.email, // `createOtp` nhận email làm người nhận, giống luồng đổi email
          purpose: otpService.PURPOSE_PASSWORD_RESET,
          expiresMinutes: RESET_TOKEN_TTL_MINUTES,
        });
      } catch (err) {
        // Xin mã lại quá sớm (trong 30s) thì KHÔNG phát mã mới, nhưng vẫn trả về
        // đúng câu trả lời chung như mọi trường hợp khác. Nếu để lỗi 429 này lọt
        // ra ngoài, kẻ tấn công chỉ cần gửi hai request liên tiếp: nhận 429 nghĩa
        // là email có thật, nhận 200 nghĩa là không — hỏng luôn cơ chế chống liệt
        // kê tài khoản. Mã người dùng đang cầm vẫn còn hiệu lực nên không mất gì.
        if (err?.errorCode !== CODES.OTP_RESEND_TOO_SOON) throw err;
      }
    } else {
      const resetToken = await issueWebResetToken(user);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;
      await mailService.sendWebPasswordResetEmail(user.email, resetUrl, {
        expiresMinutes: RESET_TOKEN_TTL_MINUTES,
      });
    }
  }

  return apiSuccess(SUCCESS.AUTH_RESET_EMAIL_SENT);
};
/**
 * Đường credential WEB: token opaque trong liên kết email.
 * Chỉ TRA CỨU, chưa tiêu thụ — việc vô hiệu hoá nằm ở bước chung phía sau.
 */
const resolveUserByWebToken = async (token) => {
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  return userRepo.findOne({
    resetPasswordTokenHash: hashedToken,
    resetPasswordExpiresAt: {
      $gt: Date.now(),
    },
  });
};

/**
 * Đường credential MOBILE: email + mã 6 số nhận qua email.
 *
 * `verifyOtpByUser` TIÊU THỤ mã ngay khi đúng (nguyên tử), nên phải gọi sau khi
 * đã kiểm tra độ dài mật khẩu mới — người dùng không đáng mất mã vì gõ mật khẩu
 * quá ngắn. Email không tồn tại cũng đi qua đúng nhánh lỗi như mã sai (xem
 * `resetPassword`), nên không suy ra được tài khoản có tồn tại hay không.
 */
const resolveUserByMobileCode = async (email, code) => {
  const user = await userRepo.findByEmail(email);
  if (!user) return null;

  await otpService.verifyOtpByUser({
    userId: user._id,
    code,
    purpose: otpService.PURPOSE_PASSWORD_RESET,
  });

  return user;
};

//rs mk
/**
 * MỘT luồng nghiệp vụ đặt lại mật khẩu duy nhất, hai đường xác thực credential:
 *
 *   Web    : { token, newPassword }
 *   Mobile : { email, code, newPassword }
 *
 * Sau khi xác thực xong, phần còn lại (kiểm tra mật khẩu, băm bcrypt, lưu, vô
 * hiệu hoá credential, ghi audit log) là CHUNG — không nhân bản logic đổi mật
 * khẩu cho từng client.
 *
 * Không đường nào cho phép đổi mật khẩu bằng "email + mật khẩu mới": thiếu cả
 * `token` và `code` là bị từ chối ngay ở dòng đầu.
 */
const resetPassword = async ({
  token,
  newPassword,
  email,
  code,
}) => {
  const hasWebToken = !!token;
  const hasMobileCode = !!email && !!code;

  if (!hasWebToken && !hasMobileCode) {
    // Giữ nguyên AUTH_TOKEN_REQUIRED cho trường hợp Web cũ (chỉ thiếu token) để
    // không đổi hợp đồng lỗi mà Web đang xử lý; thiếu hoàn toàn thông tin thì báo
    // rõ là cần một trong hai loại credential.
    throw apiErr(
      email || code ? CODES.AUTH_RESET_CREDENTIAL_REQUIRED : CODES.AUTH_TOKEN_REQUIRED,
      { statusCode: 400 },
    );
  }
  if (!newPassword || newPassword.length < 6) {
    throw apiErr(CODES.AUTH_NEW_PASSWORD_TOO_SHORT, { statusCode: 400, params: { min: 6 } });
  }

  let user = null;
  if (hasWebToken) {
    user = await resolveUserByWebToken(token);
  } else {
    try {
      user = await resolveUserByMobileCode(email, code);
    } catch (err) {
      // Mọi lý do mã không dùng được (sai, hết hạn, đã dùng, quá số lần nhập, chưa
      // từng xin mã) đều quy về MỘT lỗi giống hệt nhau. Nếu phân biệt, kẻ tấn công
      // tự gửi yêu cầu quên mật khẩu cho một email rồi đoán mã: lỗi "sai mã, còn N
      // lần" nghĩa là email có thật, lỗi "chưa có mã" nghĩa là không — đúng bằng
      // một công cụ liệt kê tài khoản. Số lần nhập sai vẫn được đếm bên trong và
      // mã vẫn bị đốt sau 5 lần, chỉ là không nói ra ngoài.
      if (err?.errorCode && String(err.errorCode).startsWith('OTP_')) {
        throw apiErr(CODES.AUTH_TOKEN_INVALID, { statusCode: 400 });
      }
      throw err;
    }
  }

  if (!user) {
    throw apiErr(CODES.AUTH_TOKEN_INVALID, { statusCode: 400 });
  }

  user.passwordHash = await bcrypt.hash(
    newPassword,
    10
  );

  // Vô hiệu hoá credential của CẢ HAI client, không chỉ cái vừa dùng: đổi mật khẩu
  // xong thì liên kết Web còn sống và mã Mobile chưa dùng đều phải chết theo.
  user.resetPasswordTokenHash = undefined;
  user.resetPasswordExpiresAt = undefined;

  await userRepo.saveUser(user);

  await otpService.invalidateActiveOtps({
    userId: user._id,
    purpose: otpService.PURPOSE_PASSWORD_RESET,
  });

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'RESET_PASSWORD',
    displayAction: 'Đặt lại mật khẩu',
    module: 'auth',
    businessModule: 'auth',
    targetEntityType: 'User',
    targetEntityId: user._id.toString(),
    targetName: user.fullName,
    description: `${user.fullName} đã đặt lại mật khẩu qua email`,
    beforeData: { passwordChanged: false },
    afterData: { passwordChanged: true },
  });

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

  const beforeData = {};
  const afterData = {};
  allowedFields.forEach((field) => {
    if (data[field] !== undefined) {
      beforeData[field] = user[field];
      afterData[field] = data[field];
    }
  });

  await createAuditLog({
    actorUserId: currentUser?._id,
    actorRole: currentUser?.role,
    action: 'UPDATE_USER_BY_ADMIN',
    displayAction: 'Cập nhật tài khoản người dùng',
    module: 'auth',
    businessModule: 'auth',
    targetEntityType: 'User',
    targetEntityId: user._id.toString(),
    targetName: user.fullName,
    description: `Admin cập nhật tài khoản ${user.role} của ${user.fullName} (${user.email})`,
    beforeData,
    afterData,
  });

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

module.exports = { login, getMe, listStaffAccounts, searchFamilyAccounts, createStaffAccount,
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

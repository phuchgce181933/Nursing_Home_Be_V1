const userRepo = require('../repositories/userRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const { isAssignableRole } = require('../utils/staffAssignment');

const ROLE_PREFIX = {
  doctor: 'DOC',
  nurse: 'NUR',
  caregiver: 'CAR',
  staff: 'STF',
  pharmacist: 'PHA',
};

const nextStaffCode = async (role) => {
  const prefix = ROLE_PREFIX[role] || 'STF';
  const existing = await staffProfileRepo.findByFilterLean(
    { staffCode: new RegExp(`^${prefix}`) },
    { select: 'staffCode' }
  );
  let max = 0;
  for (const row of existing) {
    const n = parseInt(String(row.staffCode).replace(prefix, ''), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
};

/**
 * Backfill StaffProfile for active users with assignable roles (shift/care task).
 * Fixes legacy accounts created without a profile (e.g. caregiver@gmail.com).
 */
const ensureStaffProfilesForAssignableUsers = async () => {
  const users = await userRepo.findByFilterLean({ isActive: true, isBanned: { $ne: true } }, { select: '_id email role fullName' });
  const assignable = users.filter((u) => isAssignableRole(u.role));
  if (!assignable.length) return { created: 0 };

  const existing = await staffProfileRepo.findByUserIds(assignable.map((u) => u._id));
  const hasProfile = new Set(existing.map((p) => String(p.userId)));
  const missing = assignable.filter((u) => !hasProfile.has(String(u._id)));

  let created = 0;
  for (const user of missing) {
    const staffCode = await nextStaffCode(user.role);
    await staffProfileRepo.createStaffProfile({
      userId: user._id,
      staffCode,
      roleCategory: user.role,
      specialty: 'Chưa cập nhật',
      assignedResidentIds: [],
    });
    console.log(`✅ Created StaffProfile ${staffCode} for ${user.email} (${user.role})`);
    created += 1;
  }

  if (created) {
    console.log(`Staff profile bootstrap: created ${created} missing profile(s).`);
  }

  return { created };
};

const ensureStaffProfileForUser = async (user) => {
  console.log('[DEBUG] ensureStaffProfileForUser - Input user:', { _id: user?._id, role: user?.role, email: user?.email });

  if (!user?._id) {
    console.log('[DEBUG] ensureStaffProfileForUser - User has no _id, returning null');
    return null;
  }

  const isAssignable = isAssignableRole(user.role);
  console.log('[DEBUG] ensureStaffProfileForUser - isAssignableRole(', user.role, '):', isAssignable);

  if (!isAssignable) {
    console.log('[ERROR] ensureStaffProfileForUser - Role is not assignable, cannot create profile');
    return null;
  }

  const existing = await staffProfileRepo.findByUserId(user._id);
  console.log('[DEBUG] ensureStaffProfileForUser - Existing profile found:', !!existing);
  if (existing) return existing;

  console.log('[DEBUG] ensureStaffProfileForUser - Creating new staff profile...');
  const staffCode = await nextStaffCode(user.role);
  console.log('[DEBUG] ensureStaffProfileForUser - Generated staffCode:', staffCode);

  const created = await staffProfileRepo.createStaffProfile({
    userId: user._id,
    staffCode,
    roleCategory: user.role,
    specialty: 'Chưa cập nhật',
    assignedResidentIds: [],
  });
  console.log(`✅ Auto-created StaffProfile ${staffCode} for ${user.email} (${user.role})`);
  console.log('[DEBUG] ensureStaffProfileForUser - Created profile _id:', created._id);
  return created;
};

module.exports = { ensureStaffProfilesForAssignableUsers, ensureStaffProfileForUser };

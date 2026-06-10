const User = require('../models/user');
const StaffProfile = require('../models/staffProfile');
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
  const existing = await StaffProfile.find({ staffCode: new RegExp(`^${prefix}`) })
    .select('staffCode')
    .lean();
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
  const users = await User.find({ isActive: true, isBanned: { $ne: true } }).select('_id email role fullName');
  const assignable = users.filter((u) => isAssignableRole(u.role));
  if (!assignable.length) return { created: 0 };

  const existing = await StaffProfile.find({
    userId: { $in: assignable.map((u) => u._id) },
  }).select('userId');
  const hasProfile = new Set(existing.map((p) => String(p.userId)));
  const missing = assignable.filter((u) => !hasProfile.has(String(u._id)));

  let created = 0;
  for (const user of missing) {
    const staffCode = await nextStaffCode(user.role);
    await StaffProfile.create({
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
  if (!user?._id || !isAssignableRole(user.role)) return null;
  const existing = await StaffProfile.findOne({ userId: user._id });
  if (existing) return existing;

  const staffCode = await nextStaffCode(user.role);
  const created = await StaffProfile.create({
    userId: user._id,
    staffCode,
    roleCategory: user.role,
    specialty: 'Chưa cập nhật',
    assignedResidentIds: [],
  });
  console.log(`✅ Auto-created StaffProfile ${staffCode} for ${user.email} (${user.role})`);
  return created;
};

module.exports = { ensureStaffProfilesForAssignableUsers, ensureStaffProfileForUser };

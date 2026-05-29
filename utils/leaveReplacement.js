const ServiceError = require('../services/serviceError');
const shiftRepo = require('../repositories/shiftRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const userRepo = require('../repositories/userRepository');
const StaffProfile = require('../models/staffProfile');
const { checkConflicts } = require('../services/shiftService');
const { assertAssignableStaffProfile, isAssignableRole } = require('./staffAssignment');

const COVERABLE_SHIFT_STATUSES = ['draft', 'published', 'confirmed'];

const formatShiftToCover = (shift) => ({
  _id: shift._id,
  workDate: shift.workDate,
  name: shift.name,
  startTime: shift.startTime,
  endTime: shift.endTime,
  status: shift.status,
  shiftTemplateId: shift.shiftTemplateId?._id || shift.shiftTemplateId || null,
});

const getShiftsToCoverOnLeave = async (staffProfileId, startDate, endDate) => {
  const shifts = await shiftRepo.findByStaffAndDateRange(staffProfileId, startDate, endDate);
  return shifts.filter((s) => COVERABLE_SHIFT_STATUSES.includes(s.status));
};

const resolveReplacementProfileId = async (id) => {
  const byProfileId = await staffProfileRepo.findById(id);
  if (byProfileId) return byProfileId._id;
  const byUserId = await staffProfileRepo.findByUserId(id);
  if (byUserId) return byUserId._id;
  throw new ServiceError('Staff profile not found for replacementStaffProfileId', 404);
};

const evaluateReplacementForShifts = async (replacementProfileId, shiftsToCover) => {
  const shiftConflicts = [];
  const blockingReasons = [];

  for (const shift of shiftsToCover) {
    const templateId = shift.shiftTemplateId?._id || shift.shiftTemplateId;
    const conflicts = await checkConflicts({
      assignedStaffId: replacementProfileId,
      workDate: shift.workDate,
      startTime: shift.startTime,
      endTime: shift.endTime,
      shiftTemplateId: templateId,
    });
    const errors = conflicts.filter((c) => c.severity === 'ERROR');
    if (errors.length) {
      shiftConflicts.push({
        shiftId: shift._id,
        workDate: shift.workDate,
        name: shift.name,
        conflicts: errors,
      });
      for (const e of errors) {
        if (e.message && !blockingReasons.includes(e.message)) {
          blockingReasons.push(e.message);
        }
      }
    }
  }

  return {
    eligible: shiftConflicts.length === 0,
    blockingReasons,
    shiftConflicts,
  };
};

const assertReplacementEligible = async ({
  requesterUserId,
  requesterRole,
  replacementProfileIdInput,
  shiftsToCover,
}) => {
  if (!replacementProfileIdInput) {
    throw new ServiceError('replacementStaffProfileId is required when the requester has shifts to cover', 400);
  }

  const replacementProfileId = await resolveReplacementProfileId(replacementProfileIdInput);
  const replacementProfile = await staffProfileRepo.findById(replacementProfileId);
  if (!replacementProfile) {
    throw new ServiceError('Replacement staff profile not found', 404);
  }

  const replacementUserId = (
    replacementProfile.userId?._id || replacementProfile.userId
  )?.toString();
  if (replacementUserId === requesterUserId.toString()) {
    throw new ServiceError('Replacement staff cannot be the same person as the leave requester', 400);
  }

  const replacementRole = await assertAssignableStaffProfile(replacementProfile);
  if (replacementRole !== requesterRole) {
    throw new ServiceError(
      `Replacement staff must have the same role as the requester (${requesterRole})`,
      400
    );
  }

  const evaluation = await evaluateReplacementForShifts(replacementProfileId, shiftsToCover);
  if (!evaluation.eligible) {
    const err = new ServiceError('Replacement staff cannot cover all shifts in the leave period', 409);
    err.conflicts = evaluation.shiftConflicts;
    throw err;
  }

  return { replacementProfileId, replacementProfile, replacementRole };
};

const buildCandidateEntry = async (profile, shiftsToCover) => {
  const user = profile.userId;
  const userId = user?._id || user;
  const role = user?.role;
  const evaluation = await evaluateReplacementForShifts(profile._id, shiftsToCover);

  return {
    staffProfileId: profile._id,
    userId,
    fullName: user?.fullName || null,
    staffCode: profile.staffCode || null,
    role,
    eligible: evaluation.eligible,
    blockingReasons: evaluation.blockingReasons,
  };
};

const listReplacementCandidates = async ({ requesterRole, requesterUserId, shiftsToCover }) => {
  const staffUsers = await userRepo.findStaffUsers(
    { role: requesterRole, isActive: true, isBanned: false },
    { skip: 0, limit: 1000 }
  );

  const userIds = staffUsers
    .map((u) => u._id)
    .filter((id) => id.toString() !== requesterUserId.toString());

  if (!userIds.length) return [];

  const profiles = await StaffProfile.find({ userId: { $in: userIds } }).populate(
    'userId',
    'fullName role email'
  );

  const candidates = [];
  for (const profile of profiles) {
    if (!isAssignableRole(profile.userId?.role)) continue;
    candidates.push(await buildCandidateEntry(profile, shiftsToCover));
  }

  candidates.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return (a.fullName || '').localeCompare(b.fullName || '');
  });

  return candidates;
};

module.exports = {
  COVERABLE_SHIFT_STATUSES,
  formatShiftToCover,
  getShiftsToCoverOnLeave,
  resolveReplacementProfileId,
  evaluateReplacementForShifts,
  assertReplacementEligible,
  listReplacementCandidates,
};

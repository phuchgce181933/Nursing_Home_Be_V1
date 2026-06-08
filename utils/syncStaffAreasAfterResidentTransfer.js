const staffProfileRepo = require('../repositories/staffProfileRepository');
const { isAssignableRole } = require('./staffAssignment');

/**
 * After a resident moves, expand responsibleAreaIds / responsibleRoomIds for staff
 * who still have that resident in assignedResidentIds (additive only).
 */
const syncStaffAreasAfterResidentTransfer = async (residentId, { targetRoomId, targetFloorId }) => {
  const profiles = await staffProfileRepo.findByAssignedResidentId(residentId);
  const targetFloorStr = String(targetFloorId);
  const targetRoomStr = String(targetRoomId);
  const staffAreasSynced = [];

  for (const profile of profiles) {
    const role = profile.userId?.role;
    if (!isAssignableRole(role)) continue;

    const updateData = {};
    const addedFloorIds = [];
    const addedRoomIds = [];

    const floorIds = (profile.responsibleAreaIds || []).map((f) => String(f._id || f));
    if (!floorIds.includes(targetFloorStr)) {
      const existing = (profile.responsibleAreaIds || []).map((f) => f._id || f);
      updateData.responsibleAreaIds = [...existing, targetFloorId];
      addedFloorIds.push(targetFloorStr);
    }

    const roomIds = (profile.responsibleRoomIds || []).map((r) => String(r._id || r));
    if (roomIds.length > 0 && !roomIds.includes(targetRoomStr)) {
      const existing = (profile.responsibleRoomIds || []).map((r) => r._id || r);
      updateData.responsibleRoomIds = [...existing, targetRoomId];
      addedRoomIds.push(targetRoomStr);
    }

    if (!Object.keys(updateData).length) continue;

    await staffProfileRepo.updateById(profile._id, updateData);
    staffAreasSynced.push({
      staffProfileId: profile._id,
      staffCode: profile.staffCode,
      addedFloorIds,
      addedRoomIds,
    });
  }

  return staffAreasSynced;
};

module.exports = { syncStaffAreasAfterResidentTransfer };

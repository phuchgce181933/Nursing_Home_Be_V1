const ServiceError = require('../services/serviceError');
const careTaskRepo = require('../repositories/careTaskRepository');
const StaffProfile = require('../models/staffProfile');
const { residentCoversStaffArea } = require('./staffAssignment');

const formatBlockingTask = (task) => ({
  _id: task._id,
  residentName:
    task.residentId?.fullName || task.residentId?.residentCode || String(task.residentId?._id || ''),
  taskType: task.taskType,
  workDate: task.workDate,
  status: task.status,
  shiftId: task.shiftId?._id || task.shiftId,
});

const throwIfBlockingTasks = (tasks, message) => {
  if (!tasks.length) return;
  const err = new ServiceError(message, 409);
  err.blockingTasks = tasks.map(formatBlockingTask);
  throw err;
};

const assertNoActiveCareTasksForResidents = async (staffProfileId, residentIds) => {
  const ids = (residentIds || []).map((id) => String(id._id || id)).filter(Boolean);
  if (!ids.length) return;

  const tasks = await careTaskRepo.findActiveByStaffAndResidents(staffProfileId, ids);
  throwIfBlockingTasks(
    tasks,
    'Complete, skip, or delete pending/in-progress care tasks for affected residents before changing this assignment.'
  );
};

const assertNoActiveCareTasksForShift = async (shiftId) => {
  const tasks = await careTaskRepo.findActiveByShift(shiftId);
  throwIfBlockingTasks(
    tasks,
    'Complete, skip, or delete pending/in-progress care tasks on this shift before cancelling or deleting it.'
  );
};

/**
 * Simulates area update and returns resident _ids that would be removed from assignedResidentIds.
 */
const getResidentIdsRemovedByAreaChange = async (profile, updateData, { floorIds, roomIds }) => {
  const populated = await StaffProfile.findById(profile._id)
    .populate({
      path: 'assignedResidentIds',
      select: 'fullName residentCode roomId',
      populate: { path: 'roomId', select: 'roomNumber floorId' },
    })
    .populate('responsibleAreaIds', 'floorNumber name')
    .populate('responsibleRoomIds', 'roomNumber roomType');

  if (!populated) throw new ServiceError('Staff profile not found', 404);

  const simulated = populated.toObject();
  if (updateData.responsibleAreaIds !== undefined) {
    simulated.responsibleAreaIds = updateData.responsibleAreaIds;
  }
  if (updateData.responsibleRoomIds !== undefined) {
    simulated.responsibleRoomIds = updateData.responsibleRoomIds;
  }

  const current = populated.assignedResidentIds || [];
  const removed = current.filter((r) => !residentCoversStaffArea(r, simulated));
  return removed.map((r) => r._id);
};

module.exports = {
  assertNoActiveCareTasksForResidents,
  assertNoActiveCareTasksForShift,
  getResidentIdsRemovedByAreaChange,
};

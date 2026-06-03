const ServiceError = require('./serviceError');
const careTaskService = require('./careTaskService');
const { getStaffProfileByUserId } = require('./assignedResidentService');

const idOf = (value) => String(value?._id || value || '');

const assertResidentAssigned = (profile, residentId) => {
  if (!residentId) return;
  const assigned = (profile.assignedResidentIds || []).map((r) => idOf(r));
  if (!assigned.includes(idOf(residentId))) {
    throw new ServiceError('Cư dân không thuộc danh sách phụ trách của bạn', 403);
  }
};

const assertTaskOwnership = (task, profile) => {
  if (idOf(task.staffProfileId) !== idOf(profile._id)) {
    throw new ServiceError('Bạn không có quyền truy cập nhiệm vụ này', 403);
  }
};

const listMyCareTasks = async (userId, query = {}) => {
  const profile = await getStaffProfileByUserId(userId);
  if (query.residentId) {
    assertResidentAssigned(profile, query.residentId);
  }

  const filter = {
    staffProfileId: profile._id,
    workDate: query.workDate,
  };
  if (query.status) filter.status = query.status;
  if (query.residentId) filter.residentId = query.residentId;
  if (query.taskType) filter.taskType = query.taskType;

  return careTaskService.listCareTasks(filter, {
    page: query.page,
    limit: query.limit || 100,
  });
};

const getMyCareTask = async (userId, taskId) => {
  const profile = await getStaffProfileByUserId(userId);
  const task = await careTaskService.getCareTask(taskId);
  assertTaskOwnership(task, profile);
  return task;
};

const updateMyCareTaskStatus = async (userId, taskId, body) => {
  const profile = await getStaffProfileByUserId(userId);
  const task = await careTaskService.getCareTask(taskId);
  assertTaskOwnership(task, profile);
  return careTaskService.updateCareTaskStatus(taskId, body.status, body.notes);
};

module.exports = {
  listMyCareTasks,
  getMyCareTask,
  updateMyCareTaskStatus,
};

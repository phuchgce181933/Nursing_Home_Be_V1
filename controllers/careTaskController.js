const svc = require('../services/careTaskService');
const selfSvc = require('../services/caregiverCareTaskService');
const { sendApiError } = require('../utils/apiErrorResponse');

const getAssignmentContext = (req, res) =>
  svc
    .getAssignmentContext(req.query.workDate)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const assignCareTask = (req, res) =>
  svc
    .assignCareTask(req.body, req.user._id)
    .then((result) => res.status(201).json({ success: true, ...result }))
    .catch((err) => sendApiError(res, err));

// Admin thấy toàn bộ; nhân viên (nurse/doctor/caregiver) chỉ thấy nhiệm vụ của chính mình.
// Dùng lại caregiverCareTaskService.listMyCareTasks: nó đã ép staffProfileId và
// kiểm tra residentId theo assignedResidentIds, và trả về cùng shape kết quả.
const listCareTasks = (req, res) =>
  (req.user.role === 'admin'
    ? svc.listCareTasks(req.query, req.query)
    : selfSvc.listMyCareTasks(req.user._id, req.query)
  )
    .then((result) =>
      res.json({
        success: true,
        data: result.data,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      })
    )
    .catch((err) => {
      console.error('[listCareTasks]', err);
      sendApiError(res, err);
    });

const getCareTask = (req, res) =>
  svc
    .getCareTask(req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const updateCareTaskStatus = (req, res) =>
  svc
    .updateCareTaskStatus(req.params.id, req.body.status, req.body.notes, req.user)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const getCareTasksByShift = (req, res) =>
  svc
    .getCareTasksByShift(req.params.shiftId)
    .then((result) => res.json({ success: true, ...result }))
    .catch((err) => sendApiError(res, err));

const deleteCareTask = (req, res) =>
  svc
    .deleteCareTask(req.params.id)
    .then((result) => res.json({ success: true, ...result }))
    .catch((err) => sendApiError(res, err));

module.exports = {
  getAssignmentContext,
  assignCareTask,
  listCareTasks,
  getCareTask,
  updateCareTaskStatus,
  getCareTasksByShift,
  deleteCareTask,
};

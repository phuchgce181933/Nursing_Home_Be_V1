const svc = require('../services/careTaskService');
const { sendApiError } = require('../utils/apiErrorResponse');

const getAssignmentContext = (req, res) =>
  svc
    .getAssignmentContext(req.query.workDate)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const assignCareTask = (req, res) =>
  svc
    .assignCareTask(req.body, req.user._id, req)
    .then((result) => {
      console.log('[assignCareTask] Success, task:', result?.task?._id);
      res.status(201).json({ success: true, ...result });
    })
    .catch((err) => {
      console.error('[assignCareTask] Error:', err?.message, err?.stack);
      sendApiError(res, err);
    });

const listCareTasks = (req, res) =>
  svc
    .listCareTasks(req.query, req.query)
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
    .updateCareTaskStatus(req.params.id, req.body.status, req.body.notes, req.user, req)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const getCareTasksByShift = (req, res) =>
  svc
    .getCareTasksByShift(req.params.shiftId)
    .then((result) => res.json({ success: true, ...result }))
    .catch((err) => sendApiError(res, err));

const deleteCareTask = (req, res) =>
  svc
    .deleteCareTask(req.params.id, req.user, req)
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

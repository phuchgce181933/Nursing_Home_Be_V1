const svc = require('../services/careTaskService');

const statusCode = (err) => err.statusCode || err.status || 500;

const getAssignmentContext = (req, res) =>
  svc
    .getAssignmentContext(req.query.workDate)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const assignCareTask = (req, res) =>
  svc
    .assignCareTask(req.body, req.user._id)
    .then((data) => res.status(201).json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const listCareTasks = (req, res) =>
  svc
    .listCareTasks(req.query, req.query)
    .then((result) => res.json({ success: true, ...result }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const getCareTask = (req, res) =>
  svc
    .getCareTask(req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const updateCareTaskStatus = (req, res) =>
  svc
    .updateCareTaskStatus(req.params.id, req.body.status, req.body.notes)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const getCareTasksByShift = (req, res) =>
  svc
    .getCareTasksByShift(req.params.shiftId)
    .then((result) => res.json({ success: true, ...result }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const deleteCareTask = (req, res) =>
  svc
    .deleteCareTask(req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

module.exports = {
  getAssignmentContext,
  assignCareTask,
  listCareTasks,
  getCareTask,
  updateCareTaskStatus,
  getCareTasksByShift,
  deleteCareTask,
};

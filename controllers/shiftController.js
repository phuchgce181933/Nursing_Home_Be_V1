const svc = require('../services/shiftService');

const respond = (res, promise) =>
  promise
    .then((data) => res.json({ success: true, data }))
    .catch((err) =>
      res.status(err.status || err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.conflicts && { conflicts: err.conflicts }),
        ...(err.blockingTasks && { blockingTasks: err.blockingTasks }),
      })
    );

const listShifts = (req, res) => respond(res, svc.listShifts(req.query, req.query, req.user));
const listMyShifts = (req, res) => respond(res, svc.listMyShifts(req.user, req.query));
const getShift = (req, res) => respond(res, svc.getShift(req.params.id, req.user));
const getSchedule = (req, res) => respond(res, svc.getSchedule(req.query.fromDate, req.query.toDate, {}));

const createShift = (req, res) =>
  svc
    .createShift(req.body, req.user._id)
    .then((result) => res.status(201).json({ success: true, ...result }))
    .catch((err) =>
      res.status(err.status || err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.conflicts && { conflicts: err.conflicts }),
        ...(err.blockingTasks && { blockingTasks: err.blockingTasks }),
      })
    );

const checkConflicts = (req, res) => respond(res, svc.previewConflicts(req.query));

const publishShift = (req, res) =>
  svc.publishShift(req.params.id, req.user._id).then((result) => res.json({ success: true, ...result })).catch((err) => res.status(err.status || 500).json({ success: false, message: err.message, ...(err.conflicts && { conflicts: err.conflicts }) }));

const confirmShift = (req, res) => respond(res, svc.confirmShift(req.params.id, req.user));

const updateShift = (req, res) => {
  const isAdmin = ['admin', 'manager'].includes(req.user.role);
  svc
    .updateShift(req.params.id, req.body, req.user._id, isAdmin)
    .then((result) => res.json({ success: true, ...result }))
    .catch((err) =>
      res.status(err.status || err.statusCode || 500).json({
        success: false,
        message: err.message,
        ...(err.conflicts && { conflicts: err.conflicts }),
        ...(err.blockingTasks && { blockingTasks: err.blockingTasks }),
      })
    );
};

const cancelShift = (req, res) => respond(res, svc.cancelShift(req.params.id, req.user._id, req.body.reason));
const deleteShift = (req, res) => respond(res, svc.deleteShift(req.params.id));

module.exports = {
  listShifts,
  listMyShifts,
  getShift,
  getSchedule,
  checkConflicts,
  createShift,
  publishShift,
  confirmShift,
  updateShift,
  cancelShift,
  deleteShift,
};

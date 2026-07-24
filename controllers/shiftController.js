const svc = require('../services/shiftService');
const { sendApiError } = require('../utils/apiErrorResponse');

const respond = (res, promise) =>
  promise
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const listShifts = (req, res) => respond(res, svc.listShifts(req.query, req.query, req.user));
const listMyShifts = (req, res) => respond(res, svc.listMyShifts(req.user, req.query));
const getShift = (req, res) => respond(res, svc.getShift(req.params.id, req.user));
const getSchedule = (req, res) => respond(res, svc.getSchedule(req.query.fromDate, req.query.toDate, {}));

const createShift = (req, res) =>
  svc
    .createShift(req.body, req.user._id)
    .then((result) => res.status(201).json({ success: true, ...result }))
    .catch((err) => sendApiError(res, err));

const checkConflicts = (req, res) => respond(res, svc.previewConflicts(req.query));

const publishShift = (req, res) =>
  svc
    .publishShift(req.params.id, req.user._id)
    .then((result) => res.json({ success: true, ...result }))
    .catch((err) => sendApiError(res, err));

const confirmShift = (req, res) => respond(res, svc.confirmShift(req.params.id, req.user));
const checkInShift = (req, res) => respond(res, svc.checkInShift(req.params.id, req.user));
const checkOutShift = (req, res) => respond(res, svc.checkOutShift(req.params.id, req.user));

const updateShift = (req, res) => {
  const isAdmin = req.user.role === 'admin';
  svc
    .updateShift(req.params.id, req.body, req.user, isAdmin, req)
    .then((result) => res.json({ success: true, ...result }))
    .catch((err) => sendApiError(res, err));
};

const cancelShift = (req, res) => respond(res, svc.cancelShift(req.params.id, req.user, req.body.reason, req));
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
  checkInShift,
  checkOutShift,
  updateShift,
  cancelShift,
  deleteShift,
};

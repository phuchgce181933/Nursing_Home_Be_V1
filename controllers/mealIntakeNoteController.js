const svc = require('../services/mealIntakeNoteService');
const { sendApiError } = require('../utils/apiErrorResponse');

const listResidents = (req, res) =>
  svc
    .listAssignedResidents(req.user._id)
    .then((result) =>
      res.json({
        success: true,
        data: result.data,
        total: result.total,
        message: result.message,
        messageKey: result.messageKey,
        params: result.params,
      })
    )
    .catch((err) => sendApiError(res, err));

const getContext = (req, res) =>
  svc
    .getMealContext(req.query.residentId, req.query.workDate, req.query.mealType, req.user._id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const listNotes = (req, res) =>
  svc
    .listIntakeNotes(req.user._id, req.query)
    .then((result) =>
      res.json({
        success: true,
        data: result.data,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        meta: result.meta,
      })
    )
    .catch((err) => sendApiError(res, err));

const adminListNotes = (req, res) =>
  svc
    .listIntakeNotesForAdmin(req.query)
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
    .catch((err) => sendApiError(res, err));

const createNote = (req, res) =>
  svc
    .createIntakeNote(req.user._id, req.body, req)
    .then((data) => res.status(201).json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const getNote = (req, res) =>
  svc
    .getIntakeNote(req.user._id, req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const updateNote = (req, res) =>
  svc
    .updateIntakeNote(req.user._id, req.params.id, req.body, req)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const deleteNote = (req, res) =>
  svc
    .deleteIntakeNote(req.user._id, req.params.id, req)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

module.exports = {
  listResidents,
  getContext,
  listNotes,
  adminListNotes,
  createNote,
  getNote,
  updateNote,
  deleteNote,
};

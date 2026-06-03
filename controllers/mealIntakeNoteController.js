const svc = require('../services/mealIntakeNoteService');

const statusCode = (err) => err.statusCode || err.status || 500;

const listResidents = (req, res) =>
  svc
    .listAssignedResidents(req.user._id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const getContext = (req, res) =>
  svc
    .getMealContext(req.query.residentId, req.query.workDate, req.query.mealType, req.user._id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

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
      })
    )
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const createNote = (req, res) =>
  svc
    .createIntakeNote(req.user._id, req.body)
    .then((data) => res.status(201).json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const getNote = (req, res) =>
  svc
    .getIntakeNote(req.user._id, req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const updateNote = (req, res) =>
  svc
    .updateIntakeNote(req.user._id, req.params.id, req.body)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const deleteNote = (req, res) =>
  svc
    .deleteIntakeNote(req.user._id, req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

module.exports = {
  listResidents,
  getContext,
  listNotes,
  createNote,
  getNote,
  updateNote,
  deleteNote,
};

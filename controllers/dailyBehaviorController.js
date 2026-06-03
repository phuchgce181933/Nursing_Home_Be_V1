const svc = require('../services/dailyBehaviorService');

const statusCode = (err) => err.statusCode || err.status || 500;

const listResidents = (req, res) =>
  svc
    .listAssignedResidents(req.user._id)
    .then((result) =>
      res.json({
        success: true,
        data: result.data,
        message: result.message,
      })
    )
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const listRecords = (req, res) =>
  svc
    .listRecords(req.user._id, req.query)
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

const createRecord = (req, res) =>
  svc
    .createRecord(req.user._id, req.body)
    .then((data) => res.status(201).json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const getRecord = (req, res) =>
  svc
    .getRecord(req.user._id, req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const updateRecord = (req, res) =>
  svc
    .updateRecord(req.user._id, req.params.id, req.body)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const deleteRecord = (req, res) =>
  svc
    .deleteRecord(req.user._id, req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

module.exports = {
  listResidents,
  listRecords,
  createRecord,
  getRecord,
  updateRecord,
  deleteRecord,
};

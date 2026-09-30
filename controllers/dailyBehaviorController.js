const svc = require('../services/dailyBehaviorService');
const { sendApiError } = require('../utils/apiErrorResponse');

const listResidents = (req, res) =>
  svc
    .listAssignedResidents(req.user._id)
    .then((result) =>
      res.json({
        success: true,
        data: result.data,
        message: result.message,
        messageKey: result.messageKey,
        params: result.params,
      })
    )
    .catch((err) => sendApiError(res, err));

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
        meta: result.meta,
      })
    )
    .catch((err) => sendApiError(res, err));

const adminListRecords = (req, res) =>
  svc
    .listRecordsForAdmin(req.query)
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

const createRecord = (req, res) =>
  svc
    .createRecord(req.user._id, req.body, req)
    .then((data) => res.status(201).json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const getRecord = (req, res) =>
  svc
    .getRecord(req.user._id, req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const updateRecord = (req, res) =>
  svc
    .updateRecord(req.user._id, req.params.id, req.body, req)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const deleteRecord = (req, res) =>
  svc
    .deleteRecord(req.user._id, req.params.id, req)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

module.exports = {
  listResidents,
  listRecords,
  adminListRecords,
  createRecord,
  getRecord,
  updateRecord,
  deleteRecord,
};

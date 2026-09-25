const svc = require('../services/mealTimeScheduleService');
const { sendApiError } = require('../utils/apiErrorResponse');

const getTemplates = (req, res) =>
  svc
    .getTemplates()
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const listResidents = (req, res) =>
  svc
    .listResidentsForMealTimeSchedule(req.query, req.user)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const getPublishedTimes = (req, res) =>
  svc
    .getPublishedTimes(req.query.workDate, req.query.residentIds || req.query.residentId)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const createDraft = (req, res) =>
  svc
    .createDraft(req.body, req.user._id, req)
    .then((data) => res.status(201).json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const updateDraft = (req, res) =>
  svc
    .updateDraft(req.params.id, req.body, req.user._id, req)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const listSchedules = (req, res) =>
  svc
    .listSchedules(req.query, req.query)
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

const getSchedule = (req, res) =>
  svc
    .getSchedule(req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const deleteDraft = (req, res) =>
  svc
    .deleteDraft(req.params.id, req)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const publishSchedule = (req, res) =>
  svc
    .publishSchedule(req.params.id, req.user._id, req)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

module.exports = {
  getTemplates,
  listResidents,
  getPublishedTimes,
  createDraft,
  updateDraft,
  listSchedules,
  getSchedule,
  deleteDraft,
  publishSchedule,
};

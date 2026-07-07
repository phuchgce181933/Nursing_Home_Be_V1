const svc = require('../services/mealPlanService');
const { sendApiError } = require('../utils/apiErrorResponse');

const getTemplates = (req, res) =>
  svc
    .getTemplates()
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const listResidents = (req, res) =>
  svc
    .listResidentsForMealPlan(req.query, req.user)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const createDraft = (req, res) =>
  svc
    .createDraft(req.body, req.user._id)
    .then((data) => res.status(201).json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const updateDraft = (req, res) =>
  svc
    .updateDraft(req.params.id, req.body, req.user._id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const listPlans = (req, res) =>
  svc
    .listPlans(req.query, req.query)
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

const getPlan = (req, res) =>
  svc
    .getPlan(req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const deleteDraft = (req, res) =>
  svc
    .deleteDraft(req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const publishPlan = (req, res) =>
  svc
    .publishPlan(req.params.id, req.user._id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

module.exports = {
  getTemplates,
  listResidents,
  createDraft,
  updateDraft,
  listPlans,
  getPlan,
  deleteDraft,
  publishPlan,
};

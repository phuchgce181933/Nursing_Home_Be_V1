const svc = require('../services/mealPlanService');

const statusCode = (err) => err.statusCode || err.status || 500;

const getTemplates = (req, res) =>
  svc
    .getTemplates()
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const listResidents = (req, res) =>
  svc
    .listResidentsForMealPlan(req.query, req.user)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const createDraft = (req, res) =>
  svc
    .createDraft(req.body, req.user._id)
    .then((data) => res.status(201).json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const updateDraft = (req, res) =>
  svc
    .updateDraft(req.params.id, req.body, req.user._id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

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
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const getPlan = (req, res) =>
  svc
    .getPlan(req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const deleteDraft = (req, res) =>
  svc
    .deleteDraft(req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const publishPlan = (req, res) =>
  svc
    .publishPlan(req.params.id, req.user._id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

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


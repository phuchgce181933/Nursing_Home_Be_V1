const svc = require('../services/caregiverDietPlanService');

const statusCode = (err) => err.statusCode || err.status || 500;

const listResidents = (req, res) =>
  svc
    .listAssignedResidents(req.user._id)
    .then((result) =>
      res.json({
        success: true,
        data: result.data,
        total: result.total,
        message: result.message,
      })
    )
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const listOverview = (req, res) =>
  svc
    .listDietPlansOverview(req.user._id, req.query)
    .then((result) => res.json({ success: true, ...result }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const getResidentPlan = (req, res) =>
  svc
    .getResidentDietPlan(req.user._id, req.params.residentId, req.query)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

module.exports = {
  listResidents,
  listOverview,
  getResidentPlan,
};

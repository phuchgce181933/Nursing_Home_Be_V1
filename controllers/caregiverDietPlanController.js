const svc = require('../services/caregiverDietPlanService');
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

const listOverview = (req, res) =>
  svc
    .listDietPlansOverview(req.user._id, req.query)
    .then((result) => res.json({ success: true, ...result }))
    .catch((err) => sendApiError(res, err));

const getResidentPlan = (req, res) =>
  svc
    .getResidentDietPlan(req.user._id, req.params.residentId, req.query)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

module.exports = {
  listResidents,
  listOverview,
  getResidentPlan,
};

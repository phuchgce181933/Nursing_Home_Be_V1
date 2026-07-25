const svc = require('../services/caregiverRehabilitationScheduleService');
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
    .listOverview(req.user._id, req.query)
    .then((result) => res.json({ success: true, ...result }))
    .catch((err) => sendApiError(res, err));

const getResidentSchedule = (req, res) =>
  svc
    .getResidentSchedule(req.user._id, req.params.residentId, req.query)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

module.exports = {
  listResidents,
  listOverview,
  getResidentSchedule,
};

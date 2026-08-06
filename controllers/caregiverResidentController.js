const svc = require('../services/assignedResidentService');
const { sendApiError } = require('../utils/apiErrorResponse');

const listResidents = (req, res) =>
  svc
    .listAssignedResidentsForUser(req.user._id, { search: req.query.search })
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

const getResident = (req, res) =>
  svc
    .getAssignedResidentById(req.user._id, req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const listResidentActivities = (req, res) =>
  svc
    .listAssignedResidentActivities(req.user._id, {
      status: req.query.status,
      from: req.query.from,
      to: req.query.to,
      page: req.query.page,
      limit: req.query.limit,
    })
    .then((result) => res.json({ success: true, ...result }))
    .catch((err) => sendApiError(res, err));

module.exports = {
  listResidents,
  getResident,
  listResidentActivities,
};

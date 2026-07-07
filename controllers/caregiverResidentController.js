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

module.exports = {
  listResidents,
  getResident,
};

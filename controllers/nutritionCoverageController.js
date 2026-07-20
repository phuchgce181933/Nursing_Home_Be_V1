const svc = require('../services/nutritionCoverageService');
const { sendApiError } = require('../utils/apiErrorResponse');

const getCoverage = (req, res) =>
  svc
    .getCoverage(req.query)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

module.exports = {
  getCoverage,
};

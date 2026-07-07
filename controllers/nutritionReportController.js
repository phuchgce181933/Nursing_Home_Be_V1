const svc = require('../services/nutritionReportService');
const { sendApiError } = require('../utils/apiErrorResponse');

const getSummary = (req, res) =>
  svc
    .getSummary(req.query, req.user)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const listResidents = (req, res) =>
  svc
    .listResidents(req.query, req.user)
    .then((result) =>
      res.json({
        success: true,
        data: result.data,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        period: result.period,
      })
    )
    .catch((err) => sendApiError(res, err));

const getResidentReport = (req, res) =>
  svc
    .getResidentReport(req.params.residentId, req.query, req.user)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

module.exports = {
  getSummary,
  listResidents,
  getResidentReport,
};

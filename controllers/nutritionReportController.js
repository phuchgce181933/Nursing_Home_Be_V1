const svc = require('../services/nutritionReportService');

const statusCode = (err) => err.statusCode || err.status || 500;

const getSummary = (req, res) =>
  svc
    .getSummary(req.query, req.user)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

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
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const getResidentReport = (req, res) =>
  svc
    .getResidentReport(req.params.residentId, req.query, req.user)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

module.exports = {
  getSummary,
  listResidents,
  getResidentReport,
};

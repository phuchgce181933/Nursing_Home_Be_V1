const reportService = require('../services/reportService');

const residentCountReport = async (req, res) => {
  try {
    const data = await reportService.getResidentCountReport(req.query);
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const summaryReport = async (req, res) => {
  try {
    const data = await reportService.getSummaryReport(req.query);
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const healthStatusReport = async (req, res) => {
  try {
    const data = await reportService.getHealthStatusReport(req.query);
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const incidentReport = async (req, res) => {
  try {
    const data = await reportService.getIncidentReport(req.query);
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const careActivityReport = async (req, res) => {
  try {
    const data = await reportService.getCareActivityReport(req.query);
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const financialReport = async (req, res) => {
  try {
    const data = await reportService.getFinancialReport(req.query);
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const timeSeriesReport = async (req, res) => {
  try {
    const data = await reportService.getTimeSeriesReport(req.query);
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const comparisonReport = async (req, res) => {
  try {
    if (!req.query.from || !req.query.to) {
      return res.status(400).json({ message: 'Comparison report requires `from` and `to` query parameters' });
    }
    const data = await reportService.getComparisonReport(req.query);
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const exportReport = async (req, res) => {
  try {
    const { csv, fileName } = await reportService.exportReport(req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const saveReportHistory = async (req, res) => {
  try {
    const snapshot = await reportService.saveReportHistory(req.user, req.body);
    res.status(201).json(snapshot);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listReportHistory = async (req, res) => {
  try {
    const data = await reportService.listReportHistory(req.query);
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  residentCountReport,
  summaryReport,
  healthStatusReport,
  incidentReport,
  careActivityReport,
  financialReport,
  timeSeriesReport,
  comparisonReport,
  exportReport,
  saveReportHistory,
  listReportHistory,
};

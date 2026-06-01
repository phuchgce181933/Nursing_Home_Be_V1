const familyPortalService = require('../services/familyPortalService');

const wrap = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getResidents = wrap((req) =>
  familyPortalService.getResidents(req.user),
);

const getResident = wrap((req) =>
  familyPortalService.getResident(req.user, req.params.residentId),
);

const getVitals = wrap((req) =>
  familyPortalService.getVitals(req.user, req.params.residentId),
);

const getHealthHistory = wrap((req) =>
  familyPortalService.getHealthHistory(req.user, req.params.residentId, req.query),
);

const getHealthChart = wrap((req) =>
  familyPortalService.getHealthChart(req.user, req.params.residentId, req.query),
);

const getCareNotes = wrap((req) =>
  familyPortalService.getCareNotes(req.user, req.params.residentId, req.query),
);

const getMedications = wrap((req) =>
  familyPortalService.getMedications(req.user, req.params.residentId, req.query),
);

const getPrescriptions = wrap((req) =>
  familyPortalService.getPrescriptions(req.user, req.params.residentId, req.query),
);

const getActivities = wrap((req) =>
  familyPortalService.getActivities(req.user, req.params.residentId, req.query),
);

const getCareAppointments = wrap((req) =>
  familyPortalService.getCareAppointments(req.user, req.params.residentId, req.query),
);

const getHealthReport = wrap((req) =>
  familyPortalService.getHealthReport(req.user, req.params.residentId, req.query),
);

// Download: trả về CSV thay vì JSON
const downloadHealthReport = async (req, res) => {
  try {
    const { csv, filename } = await familyPortalService.downloadHealthReport(
      req.user,
      req.params.residentId,
      req.query,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // BOM (EF BB BF) giúp Excel mở đúng tiếng Việt UTF-8
    res.send('﻿' + csv);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  getResidents,
  getResident,
  getVitals,
  getHealthHistory,
  getHealthChart,
  getCareNotes,
  getMedications,
  getPrescriptions,
  getActivities,
  getCareAppointments,
  getHealthReport,
  downloadHealthReport,
};

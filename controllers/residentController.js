const residentService = require('../services/residentService');

const adminCreateResident = async (req, res) => {
  try {
    const result = await residentService.adminCreateResident(req.user, req.body, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const adminListResidents = async (req, res) => {
  try {
    const result = await residentService.adminListResidents(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const adminGetResident = async (req, res) => {
  try {
    const result = await residentService.adminGetResident(req.params.residentId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const adminUpdatePersonalInfo = async (req, res) => {
  try {
    const result = await residentService.adminUpdatePersonalInfo(
      req.user,
      req.params.residentId,
      req.body,
      req
    );
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const adminUpdateFamilyInfo = async (req, res) => {
  try {
    const result = await residentService.adminUpdateFamilyInfo(
      req.user,
      req.params.residentId,
      req.body,
      req
    );
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  adminCreateResident,
  adminListResidents,
  adminGetResident,
  adminUpdatePersonalInfo,
  adminUpdateFamilyInfo,
};

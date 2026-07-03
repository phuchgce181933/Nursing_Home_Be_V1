const staffService = require('../services/staffService');
const { sendApiError } = require('../utils/apiErrorResponse');

const listStaffProfiles = async (req, res) => {
  try {
    const result = await staffService.listStaffProfiles(req.query);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const getStaffProfile = async (req, res) => {
  try {
    const result = await staffService.getStaffProfile(req.params.id);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const updateStaffProfile = async (req, res) => {
  try {
    const result = await staffService.updateStaffProfile(req.params.id, req.body, req.user);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const updateStaffRole = async (req, res) => {
  try {
    const result = await staffService.updateStaffRole(req.params.id, req.body, req.user);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const banStaff = async (req, res) => {
  try {
    const result = await staffService.banStaff(req.params.id, req.body, req.user);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const unbanStaff = async (req, res) => {
  try {
    const result = await staffService.unbanStaff(req.params.id, req.user);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const assignAreas = async (req, res) => {
  try {
    const result = await staffService.assignAreas(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const assignResidents = async (req, res) => {
  try {
    const result = await staffService.assignResidents(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const listResidentsAvailableForStaff = async (req, res) => {
  try {
    const result = await staffService.listResidentsAvailableForStaff(req.params.id, req.query);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const listAssignedResidents = async (req, res) => {
  try {
    const result = await staffService.listAssignedResidents(req.params.id);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const getAvailability = async (req, res) => {
  try {
    const result = await staffService.getAvailability(req.query);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

const getAreaCoverageStatus = async (req, res) => {
  try {
    const result = await staffService.getAreaCoverageStatus(req.params.floorId);
    res.json(result);
  } catch (err) {
    sendApiError(res, err);
  }
};

module.exports = {
  listStaffProfiles,
  getStaffProfile,
  updateStaffProfile,
  updateStaffRole,
  banStaff,
  unbanStaff,
  assignAreas,
  assignResidents,
  listResidentsAvailableForStaff,
  listAssignedResidents,
  getAvailability,
  getAreaCoverageStatus,
};

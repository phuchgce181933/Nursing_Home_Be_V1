const staffService = require('../services/staffService');

const listStaffProfiles = async (req, res) => {
  try {
    const result = await staffService.listStaffProfiles(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({ message: err.message });
  }
};

const getStaffProfile = async (req, res) => {
  try {
    const result = await staffService.getStaffProfile(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({ message: err.message });
  }
};

const updateStaffProfile = async (req, res) => {
  try {
    const result = await staffService.updateStaffProfile(req.params.id, req.body, req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({ message: err.message });
  }
};

const updateStaffRole = async (req, res) => {
  try {
    const result = await staffService.updateStaffRole(req.params.id, req.body, req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({ message: err.message });
  }
};

const banStaff = async (req, res) => {
  try {
    const result = await staffService.banStaff(req.params.id, req.body, req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({ message: err.message });
  }
};

const unbanStaff = async (req, res) => {
  try {
    const result = await staffService.unbanStaff(req.params.id, req.user);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({ message: err.message });
  }
};

const assignAreas = async (req, res) => {
  try {
    const result = await staffService.assignAreas(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
      ...(err.blockingTasks && { blockingTasks: err.blockingTasks }),
    });
  }
};

const assignResidents = async (req, res) => {
  try {
    const result = await staffService.assignResidents(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
      ...(err.blockingTasks && { blockingTasks: err.blockingTasks }),
    });
  }
};

const listResidentsAvailableForStaff = async (req, res) => {
  try {
    const result = await staffService.listResidentsAvailableForStaff(req.params.id, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({ message: err.message });
  }
};

const listAssignedResidents = async (req, res) => {
  try {
    const result = await staffService.listAssignedResidents(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({ message: err.message });
  }
};

const getAvailability = async (req, res) => {
  try {
    const result = await staffService.getAvailability(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({ message: err.message });
  }
};

const getAreaCoverageStatus = async (req, res) => {
  try {
    const result = await staffService.getAreaCoverageStatus(req.params.floorId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || err.status || 500).json({ message: err.message });
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

const servicePackageService = require('../services/servicePackageService');

const createServicePackage = async (req, res) => {
  try {
    const result = await servicePackageService.createServicePackage(req.user, req.body, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const updateServicePackage = async (req, res) => {
  try {
    const result = await servicePackageService.updateServicePackage(req.user, req.params.packageId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const deleteServicePackage = async (req, res) => {
  try {
    const result = await servicePackageService.deleteServicePackage(req.user, req.params.packageId, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listServicePackages = async (req, res) => {
  try {
    const result = await servicePackageService.listServicePackages(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getServicePackage = async (req, res) => {
  try {
    const result = await servicePackageService.getServicePackage(req.params.packageId);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  createServicePackage,
  updateServicePackage,
  deleteServicePackage,
  listServicePackages,
  getServicePackage,
};

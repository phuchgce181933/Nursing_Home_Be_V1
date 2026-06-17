const ClinicalService = require('../models/clinicalService');

const listServices = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    if (q.active) filter.active = q.active === 'true' || q.active === true;
    if (q.category) filter.category = q.category;
    if (q.search) filter.$or = [{ serviceName: { $regex: q.search, $options: 'i' } }, { serviceCode: { $regex: q.search, $options: 'i' } }];
    const data = await ClinicalService.find(filter).lean();
    return res.json({ success: true, data });
  } catch (err) {
    console.error(err.stack || err);
    return res.status(500).json({ message: err.message });
  }
};

const getService = async (req, res) => {
  try {
    const svc = await ClinicalService.findById(req.params.id).lean();
    if (!svc) return res.status(404).json({ message: 'Service not found' });
    return res.json({ success: true, data: svc });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createService = async (req, res) => {
  try {
    const body = req.body;
    const svc = new ClinicalService(body);
    await svc.save();
    return res.json({ success: true, data: svc });
  } catch (err) {
    console.error(err.stack || err);
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const updateService = async (req, res) => {
  try {
    const svc = await ClinicalService.findById(req.params.id);
    if (!svc) return res.status(404).json({ message: 'Service not found' });
    Object.assign(svc, req.body);
    await svc.save();
    return res.json({ success: true, data: svc });
  } catch (err) {
    console.error(err.stack || err);
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const deleteService = async (req, res) => {
  try {
    await ClinicalService.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    console.error(err.stack || err);
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
};

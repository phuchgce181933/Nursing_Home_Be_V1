const ECG = require('../models/ecg');

const listECG = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    if (q.residentId) filter.residentId = q.residentId;
    const data = await ECG.find(filter).sort({ performedAt: -1 }).limit(200).lean();
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getECG = async (req, res) => {
  try {
    const e = await ECG.findById(req.params.id).lean();
    if (!e) return res.status(404).json({ message: 'ECG not found' });
    return res.json({ success: true, data: e });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createECG = async (req, res) => {
  try {
    const e = new ECG(req.body);
    await e.save();
    return res.json({ success: true, data: e });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const updateECG = async (req, res) => {
  try {
    const e = await ECG.findById(req.params.id);
    if (!e) return res.status(404).json({ message: 'ECG not found' });
    Object.assign(e, req.body);
    await e.save();
    return res.json({ success: true, data: e });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const finalizeECG = async (req, res) => {
  try {
    const e = await ECG.findById(req.params.id);
    if (!e) return res.status(404).json({ message: 'ECG not found' });
    e.status = 'FINALIZED';
    await e.save();
    return res.json({ success: true, data: e });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { listECG, getECG, createECG, updateECG, finalizeECG };

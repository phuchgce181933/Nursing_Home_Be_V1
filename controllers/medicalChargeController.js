const MedicalCharge = require('../models/medicalCharge');

const listCharges = async (req, res) => {
  try {
    const q = req.query || {};
    console.log('[medicalChargeController] listCharges called with query:', q);
    const filter = {};
    if (q.residentId) filter.residentId = q.residentId;
    if (q.billingStatus) filter.billingStatus = q.billingStatus;
    console.log('[medicalChargeController] Using filter:', filter);
    const data = await MedicalCharge.find(filter).sort({ performedAt: -1 }).limit(500).lean();
    console.log('[medicalChargeController] Found charges:', data.length);
    if (data.length > 0) {
      console.log('[medicalChargeController] First charge:', data[0]);
    }
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[medicalChargeController] Error:', err.message);
    return res.status(500).json({ message: err.message });
  }
};

const getCharge = async (req, res) => {
  try {
    const c = await MedicalCharge.findById(req.params.id).lean();
    if (!c) return res.status(404).json({ message: 'Charge not found' });
    return res.json({ success: true, data: c });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const updateCharge = async (req, res) => {
  try {
    const c = await MedicalCharge.findById(req.params.id);
    if (!c) return res.status(404).json({ message: 'Charge not found' });
    Object.assign(c, req.body);
    await c.save();
    return res.json({ success: true, data: c });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { listCharges, getCharge, updateCharge };

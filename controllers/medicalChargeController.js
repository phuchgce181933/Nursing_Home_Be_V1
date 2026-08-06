const MedicalCharge = require('../models/medicalCharge');
const { sendApiError } = require('../utils/apiErrorResponse');

const UPDATABLE_FIELDS = [
  'serviceName',
  'category',
  'quantity',
  'unitPrice',
  'billingStatus',
  'performedAt',
  'metadata',
];

const listCharges = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    if (q.residentId) filter.residentId = q.residentId;
    if (q.billingStatus) filter.billingStatus = q.billingStatus;
    const data = await MedicalCharge.find(filter).sort({ performedAt: -1 }).limit(500).lean();
    return res.json({ success: true, data });
  } catch (err) {
    return sendApiError(res, err);
  }
};

const getCharge = async (req, res) => {
  try {
    const c = await MedicalCharge.findById(req.params.id).lean();
    if (!c) return res.status(404).json({ message: 'Không tìm thấy khoản phí' });
    return res.json({ success: true, data: c });
  } catch (err) {
    return sendApiError(res, err);
  }
};

const updateCharge = async (req, res) => {
  try {
    const c = await MedicalCharge.findById(req.params.id);
    if (!c) return res.status(404).json({ message: 'Không tìm thấy khoản phí' });
    for (const field of UPDATABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        c[field] = req.body[field];
      }
    }
    await c.save();
    return res.json({ success: true, data: c });
  } catch (err) {
    return sendApiError(res, err);
  }
};

module.exports = { listCharges, getCharge, updateCharge };

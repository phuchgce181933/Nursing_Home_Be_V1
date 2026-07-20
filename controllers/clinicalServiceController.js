const ClinicalService = require('../models/clinicalService');

const validateFieldThresholds = (field) => {
  if (!field || field.type !== 'NUMBER') return null;

  const hasCommon =
    (field.min !== '' && field.min !== undefined && field.min !== null) ||
    (field.max !== '' && field.max !== undefined && field.max !== null);
  const hasMale =
    (field.maleMin !== '' && field.maleMin !== undefined && field.maleMin !== null) ||
    (field.maleMax !== '' && field.maleMax !== undefined && field.maleMax !== null);
  const hasFemale =
    (field.femaleMin !== '' && field.femaleMin !== undefined && field.femaleMin !== null) ||
    (field.femaleMax !== '' && field.femaleMax !== undefined && field.femaleMax !== null);

  if (hasCommon && (hasMale || hasFemale)) {
    return `Trường "${field.label}" không thể vừa dùng ngưỡng chung vừa dùng ngưỡng riêng cho nam/nữ.`;
  }

  if (hasMale || hasFemale) {
    const maleMin = field.maleMin === '' || field.maleMin === undefined || field.maleMin === null ? null : Number(field.maleMin);
    const maleMax = field.maleMax === '' || field.maleMax === undefined || field.maleMax === null ? null : Number(field.maleMax);
    const femaleMin = field.femaleMin === '' || field.femaleMin === undefined || field.femaleMin === null ? null : Number(field.femaleMin);
    const femaleMax = field.femaleMax === '' || field.femaleMax === undefined || field.femaleMax === null ? null : Number(field.femaleMax);

    if (maleMin === null || maleMax === null || femaleMin === null || femaleMax === null) {
      return `Trường "${field.label}" khi dùng ngưỡng riêng cho nam/nữ cần nhập đầy đủ Min/Max cho cả nam và nữ.`;
    }

    if ([maleMin, maleMax, femaleMin, femaleMax].some((value) => Number.isNaN(value) || value <= 1)) {
      return `Trường "${field.label}" cần có giá trị ngưỡng riêng lớn hơn 1.`;
    }

    if (maleMin >= maleMax || femaleMin >= femaleMax) {
      return `Trường "${field.label}" có Min lớn hơn hoặc bằng Max.`;
    }
  }

  if (hasCommon) {
    const min = field.min === '' || field.min === undefined || field.min === null ? null : Number(field.min);
    const max = field.max === '' || field.max === undefined || field.max === null ? null : Number(field.max);
    if (min === null || max === null) {
      return `Trường "${field.label}" khi dùng ngưỡng chung cần nhập đầy đủ Min chung và Max chung.`;
    }
    if ([min, max].some((value) => Number.isNaN(value) || value <= 1)) {
      return `Trường "${field.label}" cần có giá trị ngưỡng chung lớn hơn 1.`;
    }
    if (min >= max) {
      return `Trường "${field.label}" có Min chung lớn hơn hoặc bằng Max chung.`;
    }
  }

  return null;
};

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
    if (Array.isArray(body.fields)) {
      for (const field of body.fields) {
        const error = validateFieldThresholds(field);
        if (error) {
          return res.status(400).json({ message: error });
        }
      }
    }
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
    if (Array.isArray(req.body.fields)) {
      for (const field of req.body.fields) {
        const error = validateFieldThresholds(field);
        if (error) {
          return res.status(400).json({ message: error });
        }
      }
    }
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

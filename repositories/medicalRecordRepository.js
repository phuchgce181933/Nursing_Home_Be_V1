const MedicalRecord = require('../models/medicalRecord');

const create = async (data) => MedicalRecord.create(data);

const findByResidentId = async (residentId, { sort = { measuredAt: -1 }, skip = 0, limit = 100, from, to } = {}) => {
  const filter = { residentId };
  if (from || to) {
    filter.measuredAt = {};
    if (from) filter.measuredAt.$gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      filter.measuredAt.$lte = toDate;
    }
  }
  return MedicalRecord.find(filter)
    .populate('createdByStaffId')
    .sort(sort)
    .skip(skip)
    .limit(limit);
};

const countByResidentId = async (residentId, { from, to } = {}) => {
  const filter = { residentId };
  if (from || to) {
    filter.measuredAt = {};
    if (from) filter.measuredAt.$gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      filter.measuredAt.$lte = toDate;
    }
  }
  return MedicalRecord.countDocuments(filter);
};

const findAbnormalByResidentId = async (residentId) =>
  MedicalRecord.find({ residentId, abnormalFlag: true }).sort({ measuredAt: -1 });

module.exports = {
  create,
  findByResidentId,
  countByResidentId,
  findAbnormalByResidentId,
};

const MedicalRecord = require('../models/medicalRecord');

const create = async (data) => MedicalRecord.create(data);

const findByResidentId = async (residentId, { sort = { measuredAt: -1 }, skip = 0, limit = 100 } = {}) =>
  MedicalRecord.find({ residentId })
    .populate('createdByStaffId')
    .sort(sort)
    .skip(skip)
    .limit(limit);

const findAbnormalByResidentId = async (residentId) =>
  MedicalRecord.find({ residentId, abnormalFlag: true }).sort({ measuredAt: -1 });

module.exports = {
  create,
  findByResidentId,
  findAbnormalByResidentId,
};

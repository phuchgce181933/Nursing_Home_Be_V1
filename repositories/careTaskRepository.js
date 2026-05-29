const CareTask = require('../models/careTask');

const POPULATE = [
  { path: 'staffProfileId', select: 'staffCode roleCategory userId', populate: { path: 'userId', select: 'fullName role avatarUrl' } },
  { path: 'residentId', select: 'fullName residentCode roomId', populate: { path: 'roomId', select: 'roomNumber' } },
  { path: 'shiftId', select: 'name startTime endTime workDate status' },
  { path: 'assignedBy', select: 'fullName role' },
];

const create = async (data) => CareTask.create(data);

const findById = async (id) => CareTask.findById(id).populate(POPULATE);

const findAll = async (filter, { skip = 0, limit = 20 } = {}) =>
  CareTask.find(filter)
    .populate(POPULATE)
    .sort({ workDate: 1, scheduledTime: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

const countAll = async (filter) => CareTask.countDocuments(filter);

const findByStaffAndDate = async (staffProfileId, workDate) => {
  const dayStart = new Date(workDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(workDate);
  dayEnd.setHours(23, 59, 59, 999);
  return CareTask.find({ staffProfileId, workDate: { $gte: dayStart, $lte: dayEnd } }).populate(POPULATE);
};

const findByShift = async (shiftId) => CareTask.find({ shiftId }).populate(POPULATE);

const findActiveByStaffIds = async (staffProfileIds) =>
  CareTask.find({ staffProfileId: { $in: staffProfileIds }, status: { $in: ['pending', 'in_progress'] } })
    .select('staffProfileId status');

const findActiveByStaffIdsOnDate = async (staffProfileIds, dayStart, dayEnd) => {
  if (!staffProfileIds?.length) return [];
  return CareTask.find({
    staffProfileId: { $in: staffProfileIds },
    status: { $in: ['pending', 'in_progress'] },
    workDate: { $gte: dayStart, $lte: dayEnd },
  }).select('staffProfileId status');
};

const findActiveByStaffAndResidents = async (staffProfileId, residentIds) => {
  const ids = (residentIds || []).filter(Boolean);
  if (!ids.length) return [];
  return CareTask.find({
    staffProfileId,
    residentId: { $in: ids },
    status: { $in: ['pending', 'in_progress'] },
  }).populate(POPULATE);
};

const findActiveByShift = async (shiftId) =>
  CareTask.find({ shiftId, status: { $in: ['pending', 'in_progress'] } }).populate(POPULATE);

const updateById = async (id, data) =>
  CareTask.findByIdAndUpdate(id, data, { new: true, runValidators: true }).populate(POPULATE);

const deleteById = async (id) => CareTask.findByIdAndDelete(id);

module.exports = {
  create,
  findById,
  findAll,
  countAll,
  findByStaffAndDate,
  findByShift,
  findActiveByStaffIds,
  findActiveByStaffIdsOnDate,
  findActiveByStaffAndResidents,
  findActiveByShift,
  updateById,
  deleteById,
};

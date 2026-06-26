const Shift = require('../models/shift');

const STAFF_POPULATE = { path: 'assignedStaffId', select: 'staffCode roleCategory userId', populate: { path: 'userId', select: 'fullName role avatarUrl' } };
const TEMPLATE_POPULATE = {
  path: 'shiftTemplateId',
  select: 'name shiftCode shiftType startTime endTime colorLabel totalHours crossesMidnight isFlexibleTime',
};
const FLOOR_POPULATE = { path: 'floorId', select: 'floorNumber name' };
const ROOM_POPULATE = { path: 'roomId', select: 'roomNumber roomType' };

const create = async (data) => Shift.create(data);

const findById = async (id) =>
  Shift.findById(id)
    .populate(STAFF_POPULATE)
    .populate(TEMPLATE_POPULATE)
    .populate(FLOOR_POPULATE)
    .populate(ROOM_POPULATE);

const findAll = async (filter, { skip = 0, limit = 20, sort = { workDate: 1, startTime: 1 } } = {}) =>
  Shift.find(filter)
    .populate(STAFF_POPULATE)
    .populate(TEMPLATE_POPULATE)
    .sort(sort)
    .skip(skip)
    .limit(limit);

const countAll = async (filter) => Shift.countDocuments(filter);

// OVERLAP: same staff, same date, time overlaps
const findConflicts = async ({ assignedStaffId, workDate, startTime, endTime, excludeId }) => {
  const query = {
    assignedStaffId,
    workDate,
    status: { $nin: ['cancelled'] },
    $or: [{ startTime: { $lt: endTime }, endTime: { $gt: startTime } }],
  };
  if (excludeId) query._id = { $ne: excludeId };
  return Shift.find(query).populate(STAFF_POPULATE);
};

// OVERTIME: all shifts in the same Mon-Sun week
const findShiftsInWeek = async (assignedStaffId, weekStart, weekEnd) =>
  Shift.find({
    assignedStaffId,
    workDate: { $gte: weekStart, $lte: weekEnd },
    status: { $nin: ['cancelled'] },
  }).populate(TEMPLATE_POPULATE);

// UNDERSTAFFED: count active shifts on same floor + date
const countShiftsOnFloorAndDate = async (floorId, workDate, excludeId) => {
  const query = { floorId, workDate, status: { $nin: ['cancelled'] } };
  if (excludeId) query._id = { $ne: excludeId };
  return Shift.countDocuments(query);
};

// Template guard: future non-cancelled shifts using this template
const findFutureShiftsByTemplate = async (templateId) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Shift.find({
    shiftTemplateId: templateId,
    workDate: { $gte: today },
    status: { $nin: ['cancelled'] },
  });
};

const findByStaffAndDate = async (assignedStaffId, workDate, excludeId) => {
  const query = {
    assignedStaffId,
    workDate,
    status: { $nin: ['cancelled'] },
  };
  if (excludeId) query._id = { $ne: excludeId };
  return Shift.find(query)
    .populate(STAFF_POPULATE)
    .populate(TEMPLATE_POPULATE)
    .populate(FLOOR_POPULATE);
};

// Active shifts for a staff on a given date: published or confirmed only (used by care task gating).
const findActiveShiftsForStaffOnDate = async (assignedStaffId, workDate) => {
  const dayStart = new Date(workDate);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(workDate);
  dayEnd.setUTCHours(23, 59, 59, 999);
  return Shift.find({
    assignedStaffId,
    workDate: { $gte: dayStart, $lte: dayEnd },
    status: { $in: ['published', 'confirmed'] },
  })
    .select('_id name startTime endTime workDate status')
    .sort({ startTime: 1 })
    .lean();
};

// Batch: published/confirmed shifts for many staff on one date (emergency readiness, assignment UI).
const findShiftsByStaffIdsOnDate = async (staffProfileIds, workDate) => {
  if (!staffProfileIds?.length) return [];
  const dayStart = new Date(workDate);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(workDate);
  dayEnd.setUTCHours(23, 59, 59, 999);
  return Shift.find({
    assignedStaffId: { $in: staffProfileIds },
    workDate: { $gte: dayStart, $lte: dayEnd },
    status: { $in: ['published', 'confirmed'] },
  })
    .select('_id assignedStaffId name startTime endTime status')
    .sort({ startTime: 1 })
    .lean();
};

const findByStaffAndDateRange = async (assignedStaffId, fromDate, toDate) =>
  Shift.find({
    assignedStaffId,
    workDate: { $gte: fromDate, $lte: toDate },
    status: { $nin: ['cancelled'] },
  })
    .populate(TEMPLATE_POPULATE)
    .sort({ workDate: 1, startTime: 1 });

const findByDateRange = async (fromDate, toDate, extraFilter = {}) =>
  Shift.find({ workDate: { $gte: fromDate, $lte: toDate }, ...extraFilter })
    .populate(STAFF_POPULATE)
    .populate(TEMPLATE_POPULATE)
    .sort({ workDate: 1, startTime: 1 });

const updateById = async (id, data) =>
  Shift.findByIdAndUpdate(id, data, { new: true, runValidators: true });

const deleteById = async (id) => Shift.findByIdAndDelete(id);

const findPublishedInWorkDateRange = (fromDate, toDate) =>
  Shift.find({
    status: 'published',
    workDate: { $gte: fromDate, $lte: toDate },
  })
    .select('_id workDate startTime endTime status assignedStaffId')
    .lean();

module.exports = {
  create,
  findById,
  findAll,
  countAll,
  findConflicts,
  findShiftsInWeek,
  countShiftsOnFloorAndDate,
  findFutureShiftsByTemplate,
  findByStaffAndDate,
  findActiveShiftsForStaffOnDate,
  findShiftsByStaffIdsOnDate,
  findByStaffAndDateRange,
  findByDateRange,
  findPublishedInWorkDateRange,
  updateById,
  deleteById,
};

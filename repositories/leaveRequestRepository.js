const LeaveRequest = require('../models/leaveRequest');

const REPLACEMENT_POPULATE = {
  path: 'replacementStaffProfileId',
  select: 'staffCode roleCategory userId',
  populate: { path: 'userId', select: 'fullName email role' },
};

const create = async (data) => LeaveRequest.create(data);

const findById = async (id) =>
  LeaveRequest.findById(id)
    .populate('staffId', 'fullName email role')
    .populate('reviewedBy', 'fullName email role')
    .populate(REPLACEMENT_POPULATE);

const findAll = async (filter, { skip = 0, limit = 20 } = {}) =>
  LeaveRequest.find(filter)
    .populate('staffId', 'fullName email role')
    .populate('reviewedBy', 'fullName email role')
    .populate(REPLACEMENT_POPULATE)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

const countAll = async (filter) => LeaveRequest.countDocuments(filter);

const findApprovedOverlapping = async (staffId, startDate, endDate) =>
  LeaveRequest.find({
    staffId,
    status: 'approved',
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  });

const findOverlappingApprovedByDate = async (startDate, endDate) =>
  LeaveRequest.find({
    status: 'approved',
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  }).select('staffId');

const updateById = async (id, data) =>
  LeaveRequest.findByIdAndUpdate(id, data, { new: true, runValidators: true });

const deleteById = async (id) => LeaveRequest.findByIdAndDelete(id);

module.exports = {
  create,
  findById,
  findAll,
  countAll,
  findApprovedOverlapping,
  findOverlappingApprovedByDate,
  updateById,
  deleteById,
};

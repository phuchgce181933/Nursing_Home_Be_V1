const ResidentVisit = require('../models/residentVisit');
const { RESIDENT_VISIT_STATUSES } = require('../models/enums');

const CANCELLABLE_STATUSES = ['pending', 'approved'];
const APPROVABLE_STATUSES = ['pending'];
const REJECTABLE_STATUSES = ['pending'];

const createVisit = (data) => ResidentVisit.create(data);

const findByFamily = (familyAccountId, filter, { sort, skip, limit }) =>
  ResidentVisit.find({ familyAccountId, ...filter })
    .populate('residentId', 'fullName residentCode')
    .sort(sort)
    .skip(skip)
    .limit(limit);

const countByFamily = (familyAccountId, filter) =>
  ResidentVisit.countDocuments({ familyAccountId, ...filter });

const findActiveVisitOnDate = (residentId, startOfDate, endOfDate) =>
  ResidentVisit.findOne({
    residentId,
    requestedDate: { $gte: startOfDate, $lte: endOfDate },
    status: { $in: ['pending', 'approved'] },
  });

const findByIdForFamily = (id, familyAccountId) =>
  ResidentVisit.findOne({ _id: id, familyAccountId });

const updateVisit = (id, update) =>
  ResidentVisit.findByIdAndUpdate(id, update, { new: true, runValidators: true })
    .populate('residentId', 'fullName residentCode')
    .populate('familyAccountId', 'fullName email phone');

const findAll = (filter, { sort, skip, limit }) =>
  ResidentVisit.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate('residentId', 'fullName residentCode')
    .populate('familyAccountId', 'fullName email phone');

const countAll = (filter) => ResidentVisit.countDocuments(filter);

const findById = (id) =>
  ResidentVisit.findById(id)
    .populate('residentId', 'fullName residentCode')
    .populate('familyAccountId', 'fullName email phone');

module.exports = {
  RESIDENT_VISIT_STATUSES,
  CANCELLABLE_STATUSES,
  APPROVABLE_STATUSES,
  REJECTABLE_STATUSES,
  createVisit,
  findByFamily,
  countByFamily,
  findActiveVisitOnDate,
  findByIdForFamily,
  updateVisit,
  findAll,
  countAll,
  findById,
};

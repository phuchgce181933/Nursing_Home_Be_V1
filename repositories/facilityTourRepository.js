const FacilityTour = require('../models/facilityTour');
const { FACILITY_TOUR_STATUSES } = require('../models/enums');

const CANCELLABLE_STATUSES = ['pending', 'confirmed'];
const APPROVABLE_STATUSES = ['pending'];
const REJECTABLE_STATUSES = ['pending'];

const createTour = (data) => FacilityTour.create(data);

const findByFamily = (familyAccountId, filter, { sort, skip, limit }) =>
  FacilityTour.find({ familyAccountId, ...filter })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const countByFamily = (familyAccountId, filter) =>
  FacilityTour.countDocuments({ familyAccountId, ...filter });

const findPendingTourByFamily = (familyAccountId) =>
  FacilityTour.findOne({ familyAccountId, status: 'pending' });

const findActiveTourOnDate = (familyAccountId, startOfDate, endOfDate) =>
  FacilityTour.findOne({
    familyAccountId,
    preferredDate: { $gte: startOfDate, $lte: endOfDate },
    status: { $in: ['pending', 'confirmed'] },
  });

const findByIdForFamily = (id, familyAccountId) =>
  FacilityTour.findOne({ _id: id, familyAccountId });

const updateTour = (id, update) =>
  FacilityTour.findByIdAndUpdate(id, update, { new: true, runValidators: true })
    .populate('familyAccountId', 'fullName email phone username');

// ── Admin queries ──────────────────────────────────────────────────────────────
const findAll = (filter, { sort, skip, limit }) =>
  FacilityTour.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate('familyAccountId', 'fullName email phone username');

const countAll = (filter) => FacilityTour.countDocuments(filter);

const findByIdForAdmin = (id) =>
  FacilityTour.findById(id).populate('familyAccountId', 'fullName email phone username');

module.exports = {
  FACILITY_TOUR_STATUSES,
  CANCELLABLE_STATUSES,
  APPROVABLE_STATUSES,
  REJECTABLE_STATUSES,
  createTour,
  findByFamily,
  countByFamily,
  findPendingTourByFamily,
  findActiveTourOnDate,
  findByIdForFamily,
  updateTour,
  findAll,
  countAll,
  findByIdForAdmin,
};

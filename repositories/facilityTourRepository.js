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

const findByIdForFamily = (id, familyAccountId) =>
  FacilityTour.findOne({ _id: id, familyAccountId });

const updateTour = (id, update) =>
  FacilityTour.findByIdAndUpdate(id, update, { new: true, runValidators: true });

// ── Admin queries ──────────────────────────────────────────────────────────────
const findAll = (filter, { sort, skip, limit }) =>
  FacilityTour.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate('familyAccountId', 'fullName email phone');

const countAll = (filter) => FacilityTour.countDocuments(filter);

const findByIdForAdmin = (id) =>
  FacilityTour.findById(id).populate('familyAccountId', 'fullName email phone');

module.exports = {
  FACILITY_TOUR_STATUSES,
  CANCELLABLE_STATUSES,
  APPROVABLE_STATUSES,
  REJECTABLE_STATUSES,
  createTour,
  findByFamily,
  countByFamily,
  findByIdForFamily,
  updateTour,
  findAll,
  countAll,
  findByIdForAdmin,
};

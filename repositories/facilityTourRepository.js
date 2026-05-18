const FacilityTour = require('../models/facilityTour');
const { FACILITY_TOUR_STATUSES } = require('../models/enums');

const CANCELLABLE_STATUSES = ['pending', 'confirmed'];

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

module.exports = {
  FACILITY_TOUR_STATUSES,
  CANCELLABLE_STATUSES,
  createTour,
  findByFamily,
  countByFamily,
  findByIdForFamily,
  updateTour,
};

const Admission = require('../models/admission');
const Resident = require('../models/resident');
const { ADMISSION_STATUSES } = require('../models/enums');

const ACTIVE_ADMISSION_STATUSES = ['new_request', 'consulting', 'assessing', 'contracting'];
const CANCELLABLE_STATUSES = [...ACTIVE_ADMISSION_STATUSES];

const findActiveAdmission = (filter) =>
  Admission.findOne({ ...filter, status: { $in: ACTIVE_ADMISSION_STATUSES } });

const createAdmission = (data) => Admission.create(data);

const findByRequestCode = (requestCode) => Admission.findOne({ requestCode });

const findById = (id) => Admission.findById(id);

const findByIdForFamily = (id, familyAccountId) =>
  Admission.findOne({ _id: id, familyAccountId });

const findByFamily = (familyAccountId, filter, { sort, skip, limit }) =>
  Admission.find({ familyAccountId, ...filter })
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate('residentId', 'residentCode fullName residencyStatus');

const countByFamily = (familyAccountId, filter) =>
  Admission.countDocuments({ familyAccountId, ...filter });

const updateAdmission = (id, update) =>
  Admission.findByIdAndUpdate(id, update, { new: true, runValidators: true });

const assertFamilyResidentAccess = async (userId, residentId) => {
  const resident = await Resident.findOne({
    _id: residentId,
    familyPortalAccountIds: userId,
  });
  return resident;
};

module.exports = {
  ACTIVE_ADMISSION_STATUSES,
  CANCELLABLE_STATUSES,
  ADMISSION_STATUSES,
  findActiveAdmission,
  createAdmission,
  findByRequestCode,
  findById,
  findByIdForFamily,
  findByFamily,
  countByFamily,
  updateAdmission,
  assertFamilyResidentAccess,
};

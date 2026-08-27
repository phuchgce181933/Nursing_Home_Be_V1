const Admission = require('../models/admission');
const Resident = require('../models/resident');
const Bed = require('../models/bed');
const Room = require('../models/room');
const { ADMISSION_STATUSES } = require('../models/enums');

const ACTIVE_ADMISSION_STATUSES = ['new_request', 'consulting', 'assessing', 'contracting'];
const CANCELLABLE_STATUSES = [...ACTIVE_ADMISSION_STATUSES];
const APPROVABLE_STATUSES = ['new_request', 'consulting'];
const REJECTABLE_STATUSES = ['new_request', 'consulting'];

const findOneSorted = (filter, { sort } = {}) => {
  let q = Admission.findOne(filter);
  if (sort) q = q.sort(sort);
  return q;
};

const findActiveAdmission = (filter) =>
  Admission.findOne({ ...filter, status: { $in: ACTIVE_ADMISSION_STATUSES } });

const createAdmission = (data) => Admission.create(data);

const findByRequestCode = (requestCode) => Admission.findOne({ requestCode });

const findById = (id) => Admission.findById(id);

const findByIdForFamily = (id, familyAccountId) =>
  Admission.findOne({ _id: id, familyAccountId })
    .populate('residentId', 'residentCode fullName residencyStatus avatarUrl')
    .populate('familyAccountId', 'fullName email phone username avatarUrl')
    .populate('consultantId', 'fullName email role')
    .populate('consultedBy', 'fullName email role')
    .populate('assessedBy', 'fullName email role')
    .populate('servicePackageId', 'packageCode name tier monthlyPrice')
    .populate('assignedBedId', 'bedCode')
    .populate('assignedRoomId', 'roomNumber');

const findByFamily = (familyAccountId, filter, { sort, skip, limit }) =>
  Admission.find({ familyAccountId, ...filter })
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate('residentId', 'residentCode fullName residencyStatus avatarUrl')
    .populate('familyAccountId', 'fullName email phone username avatarUrl');

const countByFamily = (familyAccountId, filter) =>
  Admission.countDocuments({ familyAccountId, ...filter });

const updateAdmission = (id, update) =>
  Admission.findByIdAndUpdate(id, update, { new: true, runValidators: true })
    .populate('residentId', 'residentCode fullName residencyStatus avatarUrl')
    .populate('familyAccountId', 'fullName email phone username avatarUrl')
    .populate('consultantId', 'fullName email role')
    .populate('consultedBy', 'fullName email role')
    .populate('assessedBy', 'fullName email role')
    .populate('servicePackageId', 'packageCode name tier monthlyPrice')
    .populate('assignedBedId', 'bedCode')
    .populate('assignedRoomId', 'roomNumber');

const assertFamilyResidentAccess = async (userId, residentId) => {
  const resident = await Resident.findOne({
    _id: residentId,
    familyPortalAccountIds: userId,
  });
  return resident;
};

// ── Admin queries (không giới hạn theo familyAccountId) ──────────────────────
const findAll = (filter, { sort, skip, limit }) =>
  Admission.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate('residentId', 'residentCode fullName residencyStatus avatarUrl')
    .populate('familyAccountId', 'fullName email phone username avatarUrl')
    .populate('consultantId', 'fullName email role')
    .populate('consultedBy', 'fullName email role')
    .populate('assessedBy', 'fullName email role')
    .populate('servicePackageId', 'packageCode name tier monthlyPrice')
    .populate('assignedBedId', 'bedCode')
    .populate('assignedRoomId', 'roomNumber');

const countAll = (filter) => Admission.countDocuments(filter);

const findByIdForAdmin = (id) =>
  Admission.findById(id)
    .populate('residentId', 'residentCode fullName residencyStatus avatarUrl')
    .populate('familyAccountId', 'fullName email phone username avatarUrl')
    .populate('consultantId', 'fullName email role')
    .populate('consultedBy', 'fullName email role')
    .populate('assessedBy', 'fullName email role')
    .populate('servicePackageId', 'packageCode name tier monthlyPrice')
    .populate('assignedBedId', 'bedCode')
    .populate('assignedRoomId', 'roomNumber');

const distinct = (field, filter) => Admission.distinct(field, filter);

const findByFilterLean = (filter, { select } = {}) => {
  let q = Admission.find(filter);
  if (select) q = q.select(select);
  return q.lean();
};

const findOneAndUpdate = (filter, update, opts = {}) =>
  Admission.findOneAndUpdate(filter, update, opts);

module.exports = {
  distinct,
  findByFilterLean,
  findOneSorted,
  findOneAndUpdate,
  ACTIVE_ADMISSION_STATUSES,
  CANCELLABLE_STATUSES,
  APPROVABLE_STATUSES,
  REJECTABLE_STATUSES,
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
  findAll,
  countAll,
  findByIdForAdmin,
};

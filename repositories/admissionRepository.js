const Admission = require('../models/admission');
const Resident = require('../models/resident');

const ACTIVE_ADMISSION_STATUSES = ['new_request', 'consulting', 'assessing', 'contracting'];

const findActiveAdmission = (filter) =>
  Admission.findOne({ ...filter, status: { $in: ACTIVE_ADMISSION_STATUSES } });

const createAdmission = (data) => Admission.create(data);

const findByRequestCode = (requestCode) => Admission.findOne({ requestCode });

const assertFamilyResidentAccess = async (userId, residentId) => {
  const resident = await Resident.findOne({
    _id: residentId,
    familyPortalAccountIds: userId,
  });
  return resident;
};

module.exports = {
  ACTIVE_ADMISSION_STATUSES,
  findActiveAdmission,
  createAdmission,
  findByRequestCode,
  assertFamilyResidentAccess,
};

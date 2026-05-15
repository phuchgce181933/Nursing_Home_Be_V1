const Resident = require('../models/resident');
const MedicalRecord = require('../models/medicalRecord');
const CareNote = require('../models/careNote');
const MedicationAdministration = require('../models/medicationAdministration');
const Prescription = require('../models/prescription');
const Activity = require('../models/activity');
const CareAppointment = require('../models/careAppointment');

const getFamilyResidentIds = async (userId) => {
  const residents = await Resident.find({ familyPortalAccountIds: userId }, '_id');
  return residents.map((resident) => resident._id.toString());
};

const getResidentsForFamily = async (userId) =>
  Resident.find({ familyPortalAccountIds: userId })
    .select('residentCode fullName dateOfBirth gender bloodType allergies chronicConditions residencyStatus admittedAt roomId bedId')
    .populate('roomId', 'roomCode name')
    .populate('bedId', 'bedCode');

const getResidentById = async (residentId) =>
  Resident.findById(residentId)
    .select('-familyPortalAccountIds')
    .populate('roomId', 'roomCode name')
    .populate('bedId', 'bedCode');

const findMedicalRecords = async (filter, { sort = { measuredAt: -1 }, skip = 0, limit = 20 } = {}) =>
  MedicalRecord.find(filter).sort(sort).skip(skip).limit(limit);

const countMedicalRecords = async (filter) => MedicalRecord.countDocuments(filter);
const findCareNotes = async (filter, { sort = { noteAt: -1 }, skip = 0, limit = 20 } = {}) =>
  CareNote.find(filter).populate({ path: 'authorStaffId', populate: { path: 'userId', select: 'fullName' } }).sort(sort).skip(skip).limit(limit);

const countCareNotes = async (filter) => CareNote.countDocuments(filter);

const findMedicationAdministrations = async (filter, { sort = { scheduledAt: -1 }, skip = 0, limit = 20 } = {}) =>
  MedicationAdministration.find(filter).populate('prescriptionId', 'medicationName dosage route frequency').sort(sort).skip(skip).limit(limit);

const countMedicationAdministrations = async (filter) => MedicationAdministration.countDocuments(filter);

const findPrescriptions = async (filter, { sort = { startDate: -1 }, skip = 0, limit = 100 } = {}) =>
  Prescription.find(filter).populate({ path: 'prescribedByStaffId', populate: { path: 'userId', select: 'fullName' } }).sort(sort).skip(skip).limit(limit);

const findActivities = async (filter, { sort = { scheduledAt: 1 }, skip = 0, limit = 100 } = {}) =>
  Activity.find(filter).sort(sort).skip(skip).limit(limit);

const findCareAppointments = async (filter, { sort = { scheduledStartAt: 1 }, skip = 0, limit = 100 } = {}) =>
  CareAppointment.find(filter)
    .populate({ path: 'doctorStaffId', populate: { path: 'userId', select: 'fullName' } })
    .populate({ path: 'nurseStaffId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

module.exports = {
  getFamilyResidentIds,
  getResidentsForFamily,
  getResidentById,
  findMedicalRecords,
  countMedicalRecords,
  findCareNotes,
  findMedicationAdministrations,
  findPrescriptions,
  findActivities,
  findCareAppointments,
};

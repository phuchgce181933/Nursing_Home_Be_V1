const Resident = require('../models/resident');
const MedicalRecord = require('../models/medicalRecord');
const CareNote = require('../models/careNote');
const MedicationSchedule = require('../models/MedicationSchedule');
const Prescription = require('../models/prescription');
const Activity = require('../models/activity');
const CareAppointment = require('../models/careAppointment');

const ROOM_POPULATE = {
  path: 'roomId',
  select: 'roomNumber roomType floorId',
  populate: {
    path: 'floorId',
    select: 'name floorNumber',
    populate: { path: 'buildingId', select: 'name code' },
  },
};

const getFamilyResidentIds = async (userId) => {
  const residents = await Resident.find({ familyPortalAccountIds: userId }, '_id');
  return residents.map((r) => r._id.toString());
};

const getResidentsForFamily = async (userId) =>
  Resident.find({ familyPortalAccountIds: userId })
    .select('residentCode fullName dateOfBirth gender bloodType allergies chronicConditions residencyStatus admittedAt roomId bedId')
    .populate(ROOM_POPULATE)
    .populate('bedId', 'bedCode bedType status');

const getResidentById = async (residentId) =>
  Resident.findById(residentId)
    .select('-familyPortalAccountIds')
    .populate(ROOM_POPULATE)
    .populate('bedId', 'bedCode bedType status');

const findMedicalRecords = async (filter, { sort = { measuredAt: -1 }, skip = 0, limit = 20 } = {}) =>
  MedicalRecord.find(filter)
    .populate({ path: 'createdByStaffId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const countMedicalRecords = async (filter) => MedicalRecord.countDocuments(filter);

const findCareNotes = async (filter, { sort = { noteAt: -1 }, skip = 0, limit = 20 } = {}) =>
  CareNote.find(filter)
    .populate({ path: 'authorStaffId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const countCareNotes = async (filter) => CareNote.countDocuments(filter);

const findMedicationSchedules = async (filter, { sort = { scheduledTime: -1 }, skip = 0, limit = 20 } = {}) =>
  MedicationSchedule.find(filter)
    .populate('prescriptionId', 'medicationName dosage route frequency status notes')
    .populate('markedBy', 'fullName')
    .sort(sort)
    .skip(skip)
    .limit(limit);

const countMedicationSchedules = async (filter) => MedicationSchedule.countDocuments(filter);

// Prescription: supports both System A (prescribedByStaffId) and System B (doctorId)
// Sort by prescriptionDate (has default: Date.now, works for both systems)
const findPrescriptions = async (filter, { sort = { prescriptionDate: -1 }, skip = 0, limit = 20 } = {}) =>
  Prescription.find(filter)
    .populate({ path: 'prescribedByStaffId', populate: { path: 'userId', select: 'fullName' } })
    .populate('doctorId', 'fullName email')
    .sort(sort)
    .skip(skip)
    .limit(limit);

const countPrescriptions = async (filter) => Prescription.countDocuments(filter);

const findActivities = async (filter, { sort = { scheduledAt: 1 }, skip = 0, limit = 20 } = {}) =>
  Activity.find(filter).sort(sort).skip(skip).limit(limit);

const countActivities = async (filter) => Activity.countDocuments(filter);

const findCareAppointments = async (filter, { sort = { scheduledStartAt: 1 }, skip = 0, limit = 20 } = {}) =>
  CareAppointment.find(filter)
    .populate({ path: 'doctorStaffId', populate: { path: 'userId', select: 'fullName' } })
    .populate({ path: 'nurseStaffId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const countCareAppointments = async (filter) => CareAppointment.countDocuments(filter);

module.exports = {
  getFamilyResidentIds,
  getResidentsForFamily,
  getResidentById,
  findMedicalRecords,
  countMedicalRecords,
  findCareNotes,
  countCareNotes,
  findMedicationSchedules,
  countMedicationSchedules,
  findPrescriptions,
  countPrescriptions,
  findActivities,
  countActivities,
  findCareAppointments,
  countCareAppointments,
};

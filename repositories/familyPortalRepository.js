const Resident = require('../models/resident');
const MedicalRecord = require('../models/medicalRecord');
const CareNote = require('../models/careNote');
const MedicationSchedule = require('../models/MedicationSchedule');
const Prescription = require('../models/prescription');
const Activity = require('../models/activity');
const CareAppointment = require('../models/careAppointment');
const CareTask = require('../models/careTask');
const HygieneActivityRecord = require('../models/hygieneActivityRecord');
const MealIntakeNote = require('../models/mealIntakeNote');
const DailyBehaviorRecord = require('../models/dailyBehaviorRecord');
const CareScheduleDay = require('../models/careScheduleDay');
const CareScheduleEntry = require('../models/careScheduleEntry');
const Invoice = require('../models/invoice');

const getFamilyResidentIds = async (userId) => {
  const residents = await Resident.find({ familyPortalAccountIds: userId }, '_id');
  return residents.map((r) => r._id.toString());
};

const getResidentsForFamily = async (userId) =>
  Resident.find({ familyPortalAccountIds: userId, residencyStatus: 'admitted' })
    .select('residentCode fullName dateOfBirth gender bloodType avatarUrl allergies chronicConditions residencyStatus admittedAt roomId bedId servicePackage')
    .populate('roomId', 'roomNumber')
    .populate('bedId', 'bedCode');

const getResidentById = async (residentId) =>
  Resident.findById(residentId)
    .select('-familyPortalAccountIds')
    .populate('roomId', 'roomNumber')
    .populate('bedId', 'bedCode');

const findMedicalRecords = async (filter, { sort = { measuredAt: -1 }, skip = 0, limit = 20 } = {}) =>
  MedicalRecord.find(filter).sort(sort).skip(skip).limit(limit);

const countMedicalRecords = async (filter) => MedicalRecord.countDocuments(filter);

const findCareNotes = async (filter, { sort = { noteAt: -1 }, skip = 0, limit = 20 } = {}) =>
  CareNote.find(filter)
    .populate({ path: 'authorStaffId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const countCareNotes = async (filter) => CareNote.countDocuments(filter);

const findInvoicesByResidentId = async (residentId, { sort = { issuedAt: -1 }, skip = 0, limit = 20 } = {}) =>
  Invoice.find({ residentId }).sort(sort).skip(skip).limit(limit);

const findLatestInvoiceByResidentId = async (residentId) =>
  Invoice.findOne({ residentId }).sort({ issuedAt: -1 });

const countInvoicesByResidentId = async (residentId) =>
  Invoice.countDocuments({ residentId });

// MedicationSchedule (replaces MedicationAdministration for the new medication management module)
const findMedicationSchedules = async (filter, { sort = { scheduledTime: -1 }, skip = 0, limit = 20 } = {}) =>
  MedicationSchedule.find(filter)
    .populate('prescriptionId', 'diagnosisNote prescriptionDate validUntil status')
    .populate('markedBy', 'fullName')
    .sort(sort)
    .skip(skip)
    .limit(limit);

const countMedicationSchedules = async (filter) => MedicationSchedule.countDocuments(filter);

// Unpaged variant for history/compliance stats and daily-schedule views, where every
// matching record within the (bounded) date range must be aggregated, not just a page.
const findMedicationSchedulesUnpaged = async (filter, { sort = { scheduledTime: 1 } } = {}) =>
  MedicationSchedule.find(filter)
    .populate('markedBy', 'fullName role')
    .sort(sort);

// doctorId in new Prescription refs User directly (not StaffProfile)
const findPrescriptions = async (filter, { sort = { prescriptionDate: -1 }, skip = 0, limit = 100 } = {}) =>
  Prescription.find(filter)
    .populate('doctorId', 'fullName email')
    .sort(sort)
    .skip(skip)
    .limit(limit);

const findActivities = async (filter, { sort = { scheduledAt: 1 }, skip = 0, limit = 100 } = {}) =>
  Activity.find(filter).sort(sort).skip(skip).limit(limit);

const findCareAppointments = async (filter, { sort = { scheduledStartAt: 1 }, skip = 0, limit = 100 } = {}) =>
  CareAppointment.find(filter)
    .populate({ path: 'doctorStaffId', populate: { path: 'userId', select: 'fullName' } })
    .populate({ path: 'nurseStaffId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const findCareTasks = async (filter, { sort = { workDate: 1, scheduledTime: 1 }, skip = 0, limit = 200 } = {}) =>
  CareTask.find(filter)
    .populate({ path: 'staffProfileId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const findHygieneActivityRecords = async (filter, { sort = { workDate: 1, recordedAt: 1 }, skip = 0, limit = 200 } = {}) =>
  HygieneActivityRecord.find(filter)
    .populate({ path: 'recordedByStaffId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const findMealIntakeNotes = async (filter, { sort = { workDate: 1, mealType: 1 }, skip = 0, limit = 200 } = {}) =>
  MealIntakeNote.find(filter)
    .populate({ path: 'recordedByStaffId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const findDailyBehaviorRecords = async (filter, { sort = { workDate: 1, observedAt: 1 }, skip = 0, limit = 200 } = {}) =>
  DailyBehaviorRecord.find(filter)
    .populate({ path: 'recordedByStaffId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const findPublishedCareScheduleDays = async (dateFilter) => {
  const filter = { status: 'published' };
  if (Object.keys(dateFilter).length > 0) filter.workDate = dateFilter;
  return CareScheduleDay.find(filter).select('_id workDate title status publishedAt').sort({ workDate: 1 });
};

const findCareScheduleEntries = async (filter, { sort = { scheduledTime: 1 }, skip = 0, limit = 500 } = {}) =>
  CareScheduleEntry.find(filter)
    .populate({ path: 'staffProfileId', populate: { path: 'userId', select: 'fullName' } })
    .populate('careScheduleDayId', 'workDate title status')
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
  countCareNotes,
  findMedicationSchedules,
  countMedicationSchedules,
  findMedicationSchedulesUnpaged,
  findPrescriptions,
  findActivities,
  findCareAppointments,
  findCareTasks,
  findHygieneActivityRecords,
  findMealIntakeNotes,
  findDailyBehaviorRecords,
  findPublishedCareScheduleDays,
  findCareScheduleEntries,
  findInvoicesByResidentId,
  findLatestInvoiceByResidentId,
  countInvoicesByResidentId,
};

const Prescription = require('../models/prescription');
const MedicationAdministration = require('../models/medicationAdministration');
const Resident = require('../models/resident');

const RESIDENT_FIELDS = 'residentCode fullName allergies chronicConditions dateOfBirth gender bloodType';

const PRESCRIPTION_POPULATE = [
  { path: 'residentId', select: RESIDENT_FIELDS },
  {
    path: 'prescribedByStaffId',
    select: 'staffCode userId',
    populate: { path: 'userId', select: 'fullName' },
  },
];

const ADMIN_POPULATE = [
  { path: 'residentId', select: 'residentCode fullName' },
  { path: 'prescriptionId', select: 'medicationName dosage route frequency scheduleTimes' },
  {
    path: 'administeredByStaffId',
    select: 'staffCode userId',
    populate: { path: 'userId', select: 'fullName' },
  },
];

module.exports = {
  findAll: (filter, opts = {}) =>
  MedicationAdministration.find(filter)
    .populate(ADMIN_POPULATE)
    .sort(opts.sort || { scheduledAt: 1 })
    .skip(opts.skip || 0)
    .limit(opts.limit || 200),
   
  countAll: (filter) => MedicationAdministration.countDocuments(filter),
    
  findResidentsByIds: (ids) =>
    Resident.find({ _id: { $in: ids } }).select(RESIDENT_FIELDS).sort({ fullName: 1 }),

  findResidentById: (id) => Resident.findById(id).select(RESIDENT_FIELDS),

  // ── Prescriptions ──────────────────────────────
  createPrescription: (data) => Prescription.create(data),

  findPrescriptionById: (id) =>
    Prescription.findById(id).populate(PRESCRIPTION_POPULATE),

  findPrescriptions: (filter, opts = {}) =>
    Prescription.find(filter)
      .populate(PRESCRIPTION_POPULATE)
      .sort(opts.sort || { createdAt: -1 })
      .skip(opts.skip || 0)
      .limit(opts.limit || 50),

  countPrescriptions: (filter) => Prescription.countDocuments(filter),

  savePrescription: (doc) => doc.save(),

  // ── Administrations ────────────────────────────
  findAdministrations: (filter, opts = {}) =>
    MedicationAdministration.find(filter)
      .populate(ADMIN_POPULATE)
      .sort(opts.sort || { scheduledAt: 1 })
      .skip(opts.skip || 0)
      .limit(opts.limit || 200),

  countAdministrations: (filter) => MedicationAdministration.countDocuments(filter),

  findAdministrationById: (id) =>
    MedicationAdministration.findById(id).populate(ADMIN_POPULATE),

  saveAdministration: (doc) => doc.save(),

  insertManyAdministrations: (docs) => MedicationAdministration.insertMany(docs),

  findHistoryByPrescription: (prescriptionId, limit = 60) =>
    MedicationAdministration.find({ prescriptionId })
      .populate(ADMIN_POPULATE)
      .sort({ scheduledAt: -1 })
      .limit(limit),
};

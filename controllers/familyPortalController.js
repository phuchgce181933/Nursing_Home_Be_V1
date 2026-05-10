const Resident = require('../models/resident');
const MedicalRecord = require('../models/medicalRecord');
const CareNote = require('../models/careNote');
const MedicationAdministration = require('../models/medicationAdministration');
const Prescription = require('../models/prescription');
const Activity = require('../models/activity');
const CareAppointment = require('../models/careAppointment');

const getFamilyResidentIds = async (userId) => {
  const residents = await Resident.find({ familyPortalAccountIds: userId }, '_id');
  return residents.map((r) => r._id);
};

const assertResidentAccess = async (userId, residentId) => {
  const ids = await getFamilyResidentIds(userId);
  const allowed = ids.map((id) => id.toString());
  return allowed.includes(residentId);
};

const getResidents = async (req, res) => {
  try {
    const residents = await Resident.find({ familyPortalAccountIds: req.user._id })
      .select('residentCode fullName dateOfBirth gender bloodType allergies chronicConditions residencyStatus admittedAt roomId bedId')
      .populate('roomId', 'roomCode name')
      .populate('bedId', 'bedCode');
    res.json(residents);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getResident = async (req, res) => {
  try {
    if (!(await assertResidentAccess(req.user._id, req.params.residentId))) {
      return res.status(403).json({ message: 'Access denied: not your relative' });
    }

    const resident = await Resident.findById(req.params.residentId)
      .select('-familyPortalAccountIds')
      .populate('roomId', 'roomCode name')
      .populate('bedId', 'bedCode');

    if (!resident) return res.status(404).json({ message: 'Resident not found' });
    res.json(resident);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getVitals = async (req, res) => {
  try {
    if (!(await assertResidentAccess(req.user._id, req.params.residentId))) {
      return res.status(403).json({ message: 'Access denied: not your relative' });
    }

    const vitals = await MedicalRecord.findOne({ residentId: req.params.residentId }).sort({ measuredAt: -1 });
    res.json(vitals || null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getHealthHistory = async (req, res) => {
  try {
    if (!(await assertResidentAccess(req.user._id, req.params.residentId))) {
      return res.status(403).json({ message: 'Access denied: not your relative' });
    }

    const { from, to, search, page = 1, limit = 20 } = req.query;
    const filter = { residentId: req.params.residentId };
    if (from || to) {
      filter.measuredAt = {};
      if (from) filter.measuredAt.$gte = new Date(from);
      if (to) filter.measuredAt.$lte = new Date(to);
    }
    if (search) filter.summary = { $regex: search.trim(), $options: 'i' };

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      MedicalRecord.find(filter).sort({ measuredAt: -1 }).skip(skip).limit(limitNum),
      MedicalRecord.countDocuments(filter),
    ]);

    res.json({ data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getHealthChart = async (req, res) => {
  try {
    if (!(await assertResidentAccess(req.user._id, req.params.residentId))) {
      return res.status(403).json({ message: 'Access denied: not your relative' });
    }

    const { metric, from, to } = req.query;
    const VALID_METRICS = [
      'bloodPressureSystolic',
      'bloodPressureDiastolic',
      'pulse',
      'temperatureCelsius',
      'oxygenSaturation',
      'bloodSugar',
      'weightKg',
    ];

    if (metric && !VALID_METRICS.includes(metric)) {
      return res.status(400).json({ message: `metric must be one of: ${VALID_METRICS.join(', ')}` });
    }

    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(now.getDate() - 30);

    const filter = {
      residentId: req.params.residentId,
      measuredAt: {
        $gte: from ? new Date(from) : defaultFrom,
        $lte: to ? new Date(to) : now,
      },
    };

    const fields = metric ? `measuredAt ${metric} abnormalFlag` : `measuredAt ${VALID_METRICS.join(' ')} abnormalFlag`;

    const records = await MedicalRecord.find(filter).select(fields).sort({ measuredAt: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getCareNotes = async (req, res) => {
  try {
    if (!(await assertResidentAccess(req.user._id, req.params.residentId))) {
      return res.status(403).json({ message: 'Access denied: not your relative' });
    }

    const { noteType, search, from, to, page = 1, limit = 20 } = req.query;
    const VALID_NOTE_TYPES = ['meal', 'activity', 'health', 'general'];

    const filter = { residentId: req.params.residentId };
    if (noteType) {
      if (!VALID_NOTE_TYPES.includes(noteType)) {
        return res.status(400).json({ message: `noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}` });
      }
      filter.noteType = noteType;
    }
    if (search) filter.content = { $regex: search.trim(), $options: 'i' };
    if (from || to) {
      filter.noteAt = {};
      if (from) filter.noteAt.$gte = new Date(from);
      if (to) filter.noteAt.$lte = new Date(to);
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      CareNote.find(filter)
        .populate({ path: 'authorStaffId', populate: { path: 'userId', select: 'fullName' } })
        .sort({ noteAt: -1 })
        .skip(skip)
        .limit(limitNum),
      CareNote.countDocuments(filter),
    ]);

    res.json({ data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getMedications = async (req, res) => {
  try {
    if (!(await assertResidentAccess(req.user._id, req.params.residentId))) {
      return res.status(403).json({ message: 'Access denied: not your relative' });
    }

    const { status, from, to, page = 1, limit = 20 } = req.query;
    const filter = { residentId: req.params.residentId };
    if (status) filter.status = status;
    if (from || to) {
      filter.scheduledAt = {};
      if (from) filter.scheduledAt.$gte = new Date(from);
      if (to) filter.scheduledAt.$lte = new Date(to);
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      MedicationAdministration.find(filter)
        .populate('prescriptionId', 'medicationName dosage route frequency')
        .sort({ scheduledAt: -1 })
        .skip(skip)
        .limit(limitNum),
      MedicationAdministration.countDocuments(filter),
    ]);

    res.json({ data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getPrescriptions = async (req, res) => {
  try {
    if (!(await assertResidentAccess(req.user._id, req.params.residentId))) {
      return res.status(403).json({ message: 'Access denied: not your relative' });
    }

    const { status } = req.query;
    const filter = { residentId: req.params.residentId };
    if (status) filter.status = status;

    const prescriptions = await Prescription.find(filter)
      .populate({ path: 'prescribedByStaffId', populate: { path: 'userId', select: 'fullName' } })
      .sort({ startDate: -1 });

    res.json(prescriptions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getActivities = async (req, res) => {
  try {
    if (!(await assertResidentAccess(req.user._id, req.params.residentId))) {
      return res.status(403).json({ message: 'Access denied: not your relative' });
    }

    const { status, from, to } = req.query;
    const filter = { participantResidentIds: req.params.residentId };
    if (status) filter.status = status;
    if (from || to) {
      filter.scheduledAt = {};
      if (from) filter.scheduledAt.$gte = new Date(from);
      if (to) filter.scheduledAt.$lte = new Date(to);
    }

    const activities = await Activity.find(filter).sort({ scheduledAt: 1 });
    res.json(activities);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getCareAppointments = async (req, res) => {
  try {
    if (!(await assertResidentAccess(req.user._id, req.params.residentId))) {
      return res.status(403).json({ message: 'Access denied: not your relative' });
    }

    const { status, from, to } = req.query;
    const filter = { residentId: req.params.residentId };
    if (status) filter.status = status;
    if (from || to) {
      filter.scheduledStartAt = {};
      if (from) filter.scheduledStartAt.$gte = new Date(from);
      if (to) filter.scheduledStartAt.$lte = new Date(to);
    }

    const appointments = await CareAppointment.find(filter)
      .populate({ path: 'doctorStaffId', populate: { path: 'userId', select: 'fullName' } })
      .populate({ path: 'nurseStaffId', populate: { path: 'userId', select: 'fullName' } })
      .sort({ scheduledStartAt: 1 });

    res.json(appointments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getHealthReport = async (req, res) => {
  try {
    if (!(await assertResidentAccess(req.user._id, req.params.residentId))) {
      return res.status(403).json({ message: 'Access denied: not your relative' });
    }

    const { from, to } = req.query;
    const residentId = req.params.residentId;

    const dateRange = {};
    if (from || to) {
      if (from) dateRange.$gte = new Date(from);
      if (to) dateRange.$lte = new Date(to);
    }

    const hasRange = Object.keys(dateRange).length > 0;

    const resident = await Resident.findById(residentId)
      .select('-familyPortalAccountIds')
      .populate('roomId', 'roomCode name')
      .populate('bedId', 'bedCode');

    if (!resident) return res.status(404).json({ message: 'Resident not found' });

    const vitalsFilter = { residentId, ...(hasRange && { measuredAt: dateRange }) };
    const notesFilter = { residentId, ...(hasRange && { noteAt: dateRange }) };
    const apptFilter = { residentId, ...(hasRange && { scheduledStartAt: dateRange }) };
    const medFilter = { residentId, ...(hasRange && { scheduledAt: dateRange }) };

    const [vitals, careNotes, careAppointments, medications] = await Promise.all([
      MedicalRecord.find(vitalsFilter).sort({ measuredAt: -1 }).limit(100),
      CareNote.find(notesFilter)
        .populate({ path: 'authorStaffId', populate: { path: 'userId', select: 'fullName' } })
        .sort({ noteAt: -1 })
        .limit(100),
      CareAppointment.find(apptFilter)
        .populate({ path: 'doctorStaffId', populate: { path: 'userId', select: 'fullName' } })
        .populate({ path: 'nurseStaffId', populate: { path: 'userId', select: 'fullName' } })
        .sort({ scheduledStartAt: -1 })
        .limit(50),
      MedicationAdministration.find(medFilter)
        .populate('prescriptionId', 'medicationName dosage route frequency')
        .sort({ scheduledAt: -1 })
        .limit(100),
    ]);

    res.json({
      generatedAt: new Date(),
      period: { from: from || null, to: to || null },
      resident,
      summary: {
        totalVitalsRecords: vitals.length,
        totalCareNotes: careNotes.length,
        totalAppointments: careAppointments.length,
        totalMedications: medications.length,
      },
      vitals,
      careNotes,
      careAppointments,
      medications,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getResidents,
  getResident,
  getVitals,
  getHealthHistory,
  getHealthChart,
  getCareNotes,
  getMedications,
  getPrescriptions,
  getActivities,
  getCareAppointments,
  getHealthReport,
};

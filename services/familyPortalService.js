const ServiceError = require('./serviceError');
const familyPortalRepo = require('../repositories/familyPortalRepository');

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const assertResidentAccess = async (userId, residentId) => {
  const ids = await familyPortalRepo.getFamilyResidentIds(userId);
  return ids.includes(residentId.toString());
};

const getResidents = async (user) => familyPortalRepo.getResidentsForFamily(user._id);

const getResident = async (user, residentId) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }
  const resident = await familyPortalRepo.getResidentById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);
  return resident;
};

const getResidentBillingSummary = async (user, residentId) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }
  const resident = await familyPortalRepo.getResidentById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);

  const [latestInvoice, invoiceCount] = await Promise.all([
    familyPortalRepo.findLatestInvoiceByResidentId(residentId),
    familyPortalRepo.countInvoicesByResidentId(residentId),
  ]);

  return {
    resident,
    latestInvoice,
    invoiceCount,
  };
};

const getResidentInvoices = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }
  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    familyPortalRepo.findInvoicesByResidentId(residentId, { sort: { issuedAt: -1 }, skip, limit: limitNum }),
    familyPortalRepo.countInvoicesByResidentId(residentId),
  ]);
  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

const getVitals = async (user, residentId) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }
  const records = await familyPortalRepo.findMedicalRecords({ residentId }, { sort: { measuredAt: -1 }, limit: 1 });
  return records.length ? records[0] : null;
};

const getHealthHistory = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }

  const filter = { residentId };
  if (query.from || query.to) {
    filter.measuredAt = {};
    if (query.from) filter.measuredAt.$gte = new Date(query.from);
    if (query.to) filter.measuredAt.$lte = new Date(query.to);
  }
  if (query.search) filter.summary = { $regex: query.search.trim(), $options: 'i' };

  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    familyPortalRepo.findMedicalRecords(filter, { sort: { measuredAt: -1 }, skip, limit: limitNum }),
    familyPortalRepo.countMedicalRecords(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

const getHealthChart = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }

  const VALID_METRICS = [
    'bloodPressureSystolic',
    'bloodPressureDiastolic',
    'pulse',
    'temperatureCelsius',
    'oxygenSaturation',
    'bloodSugar',
    'weightKg',
  ];

  if (query.metric && !VALID_METRICS.includes(query.metric)) {
    throw new ServiceError(`metric must be one of: ${VALID_METRICS.join(', ')}`, 400);
  }

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(now.getDate() - 30);

  const filter = {
    residentId,
    measuredAt: {
      $gte: query.from ? new Date(query.from) : defaultFrom,
      $lte: query.to ? new Date(query.to) : now,
    },
  };

  const records = await familyPortalRepo.findMedicalRecords(filter, { sort: { measuredAt: 1 } });
  return records.map((record) => {
    const doc = record.toObject();
    const selected = { measuredAt: doc.measuredAt, abnormalFlag: doc.abnormalFlag };
    if (query.metric) {
      selected[query.metric] = doc[query.metric];
    } else {
      VALID_METRICS.forEach((m) => { selected[m] = doc[m]; });
    }
    return selected;
  });
};

const VALID_NOTE_TYPES = ['meal', 'activity', 'health', 'general'];

const getCareNotes = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }

  const filter = { residentId };
  if (query.noteType) {
    if (!VALID_NOTE_TYPES.includes(query.noteType)) {
      throw new ServiceError(`noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}`, 400);
    }
    filter.noteType = query.noteType;
  }
  if (query.search) filter.content = { $regex: query.search.trim(), $options: 'i' };
  if (query.from || query.to) {
    filter.noteAt = {};
    if (query.from) filter.noteAt.$gte = new Date(query.from);
    if (query.to) filter.noteAt.$lte = new Date(query.to);
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    familyPortalRepo.findCareNotes(filter, { sort: { noteAt: -1 }, skip, limit: limitNum }),
    familyPortalRepo.countCareNotes(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

const VALID_MED_STATUSES = ['PENDING', 'TAKEN', 'LATE_TAKEN', 'MISSED', 'SKIPPED'];

const getMedications = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }

  const filter = { residentId };
  if (query.status) {
    if (!VALID_MED_STATUSES.includes(query.status)) {
      throw new ServiceError(`status must be one of: ${VALID_MED_STATUSES.join(', ')}`, 400);
    }
    filter.status = query.status;
  }
  if (query.from || query.to) {
    filter.scheduledTime = {};
    if (query.from) filter.scheduledTime.$gte = new Date(query.from);
    if (query.to) filter.scheduledTime.$lte = new Date(query.to);
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    familyPortalRepo.findMedicationSchedules(filter, { sort: { scheduledTime: -1 }, skip, limit: limitNum }),
    familyPortalRepo.countMedicationSchedules(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

const VALID_PRESCRIPTION_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'];

const getPrescriptions = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }

  const filter = { residentId };
  if (query.status) {
    if (!VALID_PRESCRIPTION_STATUSES.includes(query.status)) {
      throw new ServiceError(`status must be one of: ${VALID_PRESCRIPTION_STATUSES.join(', ')}`, 400);
    }
    filter.status = query.status;
  }
  return familyPortalRepo.findPrescriptions(filter, { sort: { prescriptionDate: -1 } });
};

const getActivities = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }

  const filter = { participantResidentIds: residentId };
  if (query.status) filter.status = query.status;
  if (query.from || query.to) {
    filter.scheduledAt = {};
    if (query.from) filter.scheduledAt.$gte = new Date(query.from);
    if (query.to) filter.scheduledAt.$lte = new Date(query.to);
  }

  return familyPortalRepo.findActivities(filter, { sort: { scheduledAt: 1 } });
};

const getCareAppointments = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }

  const filter = { residentId };
  if (query.status) filter.status = query.status;
  if (query.from || query.to) {
    filter.scheduledStartAt = {};
    if (query.from) filter.scheduledStartAt.$gte = new Date(query.from);
    if (query.to) filter.scheduledStartAt.$lte = new Date(query.to);
  }

  return familyPortalRepo.findCareAppointments(filter, { sort: { scheduledStartAt: 1 } });
};

const getHealthReport = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }

  const dateRange = {};
  if (query.from) dateRange.$gte = new Date(query.from);
  if (query.to) dateRange.$lte = new Date(query.to);
  const hasRange = Object.keys(dateRange).length > 0;

  const resident = await familyPortalRepo.getResidentById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);

  const vitalsFilter = { residentId, ...(hasRange && { measuredAt: dateRange }) };
  const notesFilter  = { residentId, ...(hasRange && { noteAt: dateRange }) };
  const apptFilter   = { residentId, ...(hasRange && { scheduledStartAt: dateRange }) };
  const medFilter    = { residentId, ...(hasRange && { scheduledTime: dateRange }) };

  const [vitals, careNotes, careAppointments, medications] = await Promise.all([
    familyPortalRepo.findMedicalRecords(vitalsFilter, { sort: { measuredAt: -1 }, limit: 100 }),
    familyPortalRepo.findCareNotes(notesFilter, { sort: { noteAt: -1 }, limit: 100 }),
    familyPortalRepo.findCareAppointments(apptFilter, { sort: { scheduledStartAt: -1 }, limit: 50 }),
    familyPortalRepo.findMedicationSchedules(medFilter, { sort: { scheduledTime: -1 }, limit: 100 }),
  ]);

  return {
    generatedAt: new Date(),
    period: { from: query.from || null, to: query.to || null },
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
  };
};

module.exports = {
  getResidents,
  getResident,
  getResidentBillingSummary,
  getResidentInvoices,
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

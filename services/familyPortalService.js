const ServiceError = require('./serviceError');
const familyPortalRepo = require('../repositories/familyPortalRepository');
const servicePackageRepo = require('../repositories/servicePackageRepository');
const paymentService = require('./paymentService');
const { CARE_NOTE_TYPES } = require('../models/enums');

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

const attachServicePackagePrice = async (resident) => {
  if (!resident || !resident.servicePackage) return resident;
  const packageRecord = await servicePackageRepo.findByName(resident.servicePackage);
  resident.servicePackagePrice = packageRecord ? packageRecord.monthlyPrice : null;
  return resident;
};

const getResidents = async (user) => {
  const residents = await familyPortalRepo.getResidentsForFamily(user._id);
  return Promise.all(residents.map(attachServicePackagePrice));
};

const getResident = async (user, residentId) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }
  const resident = await familyPortalRepo.getResidentById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);
  await attachServicePackagePrice(resident);
  return resident;
};

const getResidentBillingSummary = async (user, residentId) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }
  const resident = await familyPortalRepo.getResidentById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);
  await attachServicePackagePrice(resident);

  const [latestInvoice, invoiceCount] = await Promise.all([
    familyPortalRepo.findLatestInvoiceByResidentId(residentId),
    familyPortalRepo.countInvoicesByResidentId(residentId),
  ]);

  const normalizedInvoice = latestInvoice
    ? {
        ...latestInvoice.toObject ? latestInvoice.toObject() : latestInvoice,
        totalAmount: latestInvoice.totalAmount ?? latestInvoice.total ?? latestInvoice.subTotal ?? 0,
        status: latestInvoice.status?.toString().toUpperCase?.() || 'DRAFT',
      }
    : null;

  return {
    resident,
    latestInvoice: normalizedInvoice,
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

const getInvoicePaymentUrl = async (user, residentId, invoiceId, req) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }
  
  const invoices = await familyPortalRepo.findInvoicesByResidentId(residentId, { limit: 100 });
  const foundInvoice = invoices.find(inv => String(inv._id) === String(invoiceId));
  if (!foundInvoice) throw new ServiceError('Invoice not found', 404);
  
  // Use paymentService to generate the checkout URL with checksum
  const paymentUrl = paymentService.buildPayosCheckoutUrl(req, foundInvoice);
  return { paymentUrl };
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

const getCareNotes = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }

  const filter = { residentId };
  if (query.noteType) {
    if (!CARE_NOTE_TYPES.includes(query.noteType)) {
      throw new ServiceError(`noteType must be one of: ${CARE_NOTE_TYPES.join(', ')}`, 400);
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

const VALID_MED_STATUSES = ['PENDING', 'TAKEN', 'LATE_TAKEN', 'MISSED', 'SKIPPED', 'OVERDUE'];

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

// ISO week key in local time: "YYYY-Www" (mirrors scheduleController's isoWeekKey)
const isoWeekKey = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
};

// Medication administration history with compliance stats — same shape as the
// doctor/nurse ScheduleController.getHistory, scoped to the family's own relative.
const getMedicationHistory = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }
  const resident = await familyPortalRepo.getResidentById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);

  const filter = { residentId };
  if (query.prescriptionId) filter.prescriptionId = query.prescriptionId;
  if (query.from || query.to) {
    filter.scheduledTime = {};
    if (query.from) filter.scheduledTime.$gte = new Date(query.from);
    if (query.to) filter.scheduledTime.$lte = new Date(query.to);
  }
  if (query.medicationName) filter.medicationName = { $regex: query.medicationName, $options: 'i' };

  const records = await familyPortalRepo.findMedicationSchedulesUnpaged(filter, { sort: { scheduledTime: 1 } });

  let taken = 0, lateTaken = 0, missed = 0, skipped = 0;
  for (const r of records) {
    if (r.status === 'TAKEN') taken++;
    else if (r.status === 'LATE_TAKEN') lateTaken++;
    else if (r.status === 'MISSED') missed++;
    else if (r.status === 'SKIPPED') skipped++;
  }
  const denominator = taken + lateTaken + missed;
  const complianceRate = denominator > 0 ? Math.round(((taken + lateTaken) / denominator) * 1000) / 10 : null;

  const weeklyMap = new Map();
  for (const r of records) {
    const week = isoWeekKey(new Date(r.scheduledTime));
    if (!weeklyMap.has(week)) weeklyMap.set(week, { taken: 0, missed: 0 });
    const entry = weeklyMap.get(week);
    if (r.status === 'TAKEN' || r.status === 'LATE_TAKEN') entry.taken++;
    else if (r.status === 'MISSED') entry.missed++;
  }
  const weeklyCompliance = [...weeklyMap.entries()].map(([week, { taken: t, missed: m }]) => {
    const denom = t + m;
    return { week, rate: denom > 0 ? Math.round((t / denom) * 1000) / 10 : null };
  });

  return {
    residentId,
    residentName: resident.fullName,
    summary: { total: records.length, taken, lateTaken, missed, skipped, complianceRate },
    lowCompliance: complianceRate !== null && complianceRate < 80,
    records: records.map((r) => ({
      _id: r._id,
      date: new Date(r.scheduledTime).toISOString().slice(0, 10),
      medicationName: r.medicationName,
      dosage: r.dosage,
      route: r.route,
      scheduledTime: r.scheduledTime,
      actualTimeTaken: r.actualTimeTaken || null,
      status: r.status,
      markedBy: r.markedBy || null,
      markedAt: r.markedAt || null,
      notes: r.notes || null,
      missedReason: r.missedReason || null,
    })),
    weeklyCompliance,
  };
};

// Today's (or a chosen day's) medication doses for the family's own relative.
const getDailyMedicationSchedule = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }

  let dateFilter = buildWorkDateFilter(query);
  if (Object.keys(dateFilter).length === 0) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    dateFilter = { $gte: todayStart, $lte: todayEnd };
  }

  const filter = { residentId, scheduledTime: dateFilter };
  if (query.status) filter.status = query.status;

  const schedules = await familyPortalRepo.findMedicationSchedulesUnpaged(filter, { sort: { scheduledTime: 1 } });

  return {
    date: query.date || null,
    residentId,
    schedules: schedules.map((s) => ({
      id: s._id,
      prescriptionId: s.prescriptionId,
      medicationName: s.medicationName,
      dosage: s.dosage,
      route: s.route,
      scheduledTime: s.scheduledTime,
      status: s.status,
      markedBy: s.markedBy || null,
      markedAt: s.markedAt || null,
      actualTimeTaken: s.actualTimeTaken || null,
      notes: s.notes || null,
    })),
  };
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

const buildWorkDateFilter = (query) => {
  const filter = {};
  if (query.date) {
    const start = new Date(query.date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(query.date);
    end.setHours(23, 59, 59, 999);
    filter.$gte = start;
    filter.$lte = end;
  } else {
    if (query.from) filter.$gte = new Date(query.from);
    if (query.to) filter.$lte = new Date(query.to);
  }
  return filter;
};

const getDailyActivities = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }

  // Default to today when no date params provided
  let workDateFilter = buildWorkDateFilter(query);
  if (Object.keys(workDateFilter).length === 0) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    workDateFilter = { $gte: todayStart, $lte: todayEnd };
  }

  const sharedFilter = { residentId, workDate: workDateFilter };

  const [careTasks, hygieneRecords, mealIntakeNotes, behaviorRecords] = await Promise.all([
    familyPortalRepo.findCareTasks(sharedFilter),
    familyPortalRepo.findHygieneActivityRecords(sharedFilter),
    familyPortalRepo.findMealIntakeNotes(sharedFilter),
    familyPortalRepo.findDailyBehaviorRecords(sharedFilter),
  ]);

  return {
    date: query.date || null,
    from: query.from || null,
    to: query.to || null,
    careTasks,
    hygieneRecords,
    mealIntakeNotes,
    behaviorRecords,
  };
};

const getCareSchedule = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }

  // Default to today when no date params provided
  let dateFilter = buildWorkDateFilter(query);
  if (Object.keys(dateFilter).length === 0) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    dateFilter = { $gte: todayStart, $lte: todayEnd };
  }

  const days = await familyPortalRepo.findPublishedCareScheduleDays(dateFilter);
  if (!days.length) return [];

  const dayIds = days.map((d) => d._id);
  const entries = await familyPortalRepo.findCareScheduleEntries({
    careScheduleDayId: { $in: dayIds },
    residentId,
  });

  const dayMap = {};
  days.forEach((d) => {
    dayMap[d._id.toString()] = { ...d.toObject(), entries: [] };
  });
  entries.forEach((e) => {
    const key = e.careScheduleDayId?._id
      ? e.careScheduleDayId._id.toString()
      : e.careScheduleDayId.toString();
    if (dayMap[key]) dayMap[key].entries.push(e);
  });

  return Object.values(dayMap);
};

const escapeCSV = (val) => {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const row = (...cols) => cols.map(escapeCSV).join(',');

const downloadReport = async (user, residentId, query) => {
  if (!(await assertResidentAccess(user._id, residentId))) {
    throw new ServiceError('Access denied: not your relative', 403);
  }

  const resident = await familyPortalRepo.getResidentById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);

  const dateRange = {};
  if (query.from) dateRange.$gte = new Date(query.from);
  if (query.to) dateRange.$lte = new Date(query.to);
  const hasRange = Object.keys(dateRange).length > 0;

  const vitalsFilter = { residentId, ...(hasRange && { measuredAt: dateRange }) };
  const notesFilter = { residentId, ...(hasRange && { noteAt: dateRange }) };
  const apptFilter = { residentId, ...(hasRange && { scheduledStartAt: dateRange }) };
  const medFilter = { residentId, ...(hasRange && { scheduledTime: dateRange }) };

  const [vitals, careNotes, careAppointments, medications] = await Promise.all([
    familyPortalRepo.findMedicalRecords(vitalsFilter, { sort: { measuredAt: -1 }, limit: 500 }),
    familyPortalRepo.findCareNotes(notesFilter, { sort: { noteAt: -1 }, limit: 500 }),
    familyPortalRepo.findCareAppointments(apptFilter, { sort: { scheduledStartAt: -1 }, limit: 200 }),
    familyPortalRepo.findMedicationSchedules(medFilter, { sort: { scheduledTime: -1 }, limit: 500 }),
  ]);

  const r = resident.toObject ? resident.toObject() : resident;
  const lines = [];

  lines.push(row('NURSING HOME HEALTH REPORT'));
  lines.push(row('Generated At', new Date().toISOString()));
  lines.push(row('Period From', query.from || 'All'));
  lines.push(row('Period To', query.to || 'All'));
  lines.push('');

  lines.push(row('RESIDENT PROFILE'));
  lines.push(row('Field', 'Value'));
  lines.push(row('Full Name', r.fullName));
  lines.push(row('Resident Code', r.residentCode));
  lines.push(row('Date of Birth', r.dateOfBirth ? new Date(r.dateOfBirth).toISOString().slice(0, 10) : ''));
  lines.push(row('Gender', r.gender));
  lines.push(row('Blood Type', r.bloodType));
  lines.push(row('Room', r.roomId?.name || ''));
  lines.push(row('Bed', r.bedId?.bedCode || ''));
  lines.push(row('Admitted At', r.admittedAt ? new Date(r.admittedAt).toISOString().slice(0, 10) : ''));
  lines.push(row('Service Package', r.servicePackage || ''));
  lines.push(row('Chronic Conditions', (r.chronicConditions || []).join('; ')));
  lines.push(row('Drug Allergies', (r.drugAllergies || []).join('; ')));
  lines.push('');

  lines.push(row('SUMMARY'));
  lines.push(row('Category', 'Count'));
  lines.push(row('Vital Signs Records', vitals.length));
  lines.push(row('Care Notes', careNotes.length));
  lines.push(row('Care Appointments', careAppointments.length));
  lines.push(row('Medication Records', medications.length));
  lines.push('');

  lines.push(row('VITAL SIGNS'));
  lines.push(row('Date', 'Systolic BP', 'Diastolic BP', 'Pulse', 'Temperature (C)', 'O2 Saturation (%)', 'Blood Sugar (mg/dL)', 'Weight (kg)', 'Abnormal', 'Summary'));
  vitals.forEach((v) => {
    lines.push(row(
      v.measuredAt ? new Date(v.measuredAt).toISOString() : '',
      v.bloodPressureSystolic, v.bloodPressureDiastolic,
      v.pulse, v.temperatureCelsius, v.oxygenSaturation,
      v.bloodSugar, v.weightKg,
      v.abnormalFlag ? 'Yes' : 'No',
      v.summary,
    ));
  });
  lines.push('');

  lines.push(row('CARE NOTES'));
  lines.push(row('Date', 'Type', 'Content', 'Author'));
  careNotes.forEach((n) => {
    lines.push(row(
      n.noteAt ? new Date(n.noteAt).toISOString() : '',
      n.noteType,
      n.content,
      n.authorStaffId?.userId?.fullName || '',
    ));
  });
  lines.push('');

  lines.push(row('MEDICATION HISTORY'));
  lines.push(row('Scheduled Time', 'Medication', 'Dosage', 'Route', 'Status', 'Actual Time Taken', 'Missed Reason'));
  medications.forEach((m) => {
    lines.push(row(
      m.scheduledTime ? new Date(m.scheduledTime).toISOString() : '',
      m.medicationName, m.dosage, m.route,
      m.status,
      m.actualTimeTaken ? new Date(m.actualTimeTaken).toISOString() : '',
      m.missedReason,
    ));
  });
  lines.push('');

  lines.push(row('CARE APPOINTMENTS'));
  lines.push(row('Start Time', 'End Time', 'Type', 'Status', 'Doctor', 'Nurse', 'Notes'));
  careAppointments.forEach((a) => {
    lines.push(row(
      a.scheduledStartAt ? new Date(a.scheduledStartAt).toISOString() : '',
      a.scheduledEndAt ? new Date(a.scheduledEndAt).toISOString() : '',
      a.appointmentType, a.status,
      a.doctorStaffId?.userId?.fullName || '',
      a.nurseStaffId?.userId?.fullName || '',
      a.notes,
    ));
  });

  const filename = `health-report-${r.residentCode}-${new Date().toISOString().slice(0, 10)}.csv`;
  return { csv: lines.join('\r\n'), filename };
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
  getInvoicePaymentUrl,
  getVitals,
  getHealthHistory,
  getHealthChart,
  getCareNotes,
  getMedications,
  getPrescriptions,
  getMedicationHistory,
  getDailyMedicationSchedule,
  getActivities,
  getCareAppointments,
  getHealthReport,
  getDailyActivities,
  getCareSchedule,
  downloadReport,
};

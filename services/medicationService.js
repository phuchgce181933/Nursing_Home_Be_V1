// DEPRECATED — This service is no longer used. Clinical prescription logic is in prescriptionController.js
// and scheduleController.js. Pharmacy logic is in pharmacyService.js.
const ServiceError = require('./serviceError');
const medRepo = require('../repositories/medicationRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');

// Returns null for admin/manager (unrestricted) or array of ObjectIds for doctor/nurse
const getResidentScope = async (user) => {
  if (['admin', 'manager'].includes(user.role)) return null;
  const profile = await staffProfileRepo.findByUserId(user._id);
  if (!profile) throw new ServiceError('Staff profile not found', 404);
  return profile.assignedResidentIds || [];
};

const applyScope = (filter, residentIds) => {
  if (residentIds === null) return filter;
  return { ...filter, residentId: { $in: residentIds } };
};

const isResidentAccessible = (residentId, residentIds) => {
  if (residentIds === null) return true;
  return residentIds.map(String).includes(String(residentId));
};

// ── Residents ──────────────────────────────────────────

const getMyResidents = async (user) => {
  const residentIds = await getResidentScope(user);
  if (residentIds === null) {
    // admin/manager: return all active residents
    const Resident = require('../models/resident');
    return Resident.find({ residencyStatus: 'admitted' })
      .select('residentCode fullName allergies chronicConditions dateOfBirth gender bloodType')
      .sort({ fullName: 1 });
  }
  return medRepo.findResidentsByIds(residentIds);
};

// ── Prescriptions ──────────────────────────────────────

const listPrescriptions = async (user, query) => {
  const residentIds = await getResidentScope(user);
  let filter = {};
  if (query.residentId) filter.residentId = query.residentId;
  if (query.status) filter.status = query.status;
  if (query.medicationName) filter.medicationName = new RegExp(query.medicationName, 'i');
  filter = applyScope(filter, residentIds);

  const page = Math.max(1, parseInt(query.page || 1, 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || 50, 10)));
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    medRepo.findPrescriptions(filter, { skip, limit }),
    medRepo.countPrescriptions(filter),
  ]);

  // Fetch invoice information for each prescription
  const Invoice = require('../models/invoice');
  const invoicesByPrescription = {};
  for (const rx of data) {
    const invoices = await Invoice.find({ prescriptionId: rx._id }).select('status');
    invoicesByPrescription[rx._id] = invoices;
  }

  const enrichedData = data.map((rx) => {
    const invoices = invoicesByPrescription[rx._id] || [];
    let invoiceStatus = 'no_invoice';
    let paymentStatus = null;
    if (invoices.length > 0) {
      const latestInvoice = invoices[0];
      // Normalize invoice status to lowercase for frontend
      const status = (latestInvoice.status || 'unpaid').toLowerCase();
      paymentStatus = status === 'paid' ? 'paid' : 
                     status === 'partially_paid' ? 'partially_paid' : 'unpaid';
      invoiceStatus = paymentStatus;
    }
    
    return {
      ...rx,
      invoiceStatus,
      paymentStatus,
    };
  });

  return { data: enrichedData, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const getPrescription = async (user, id) => {
  const prescription = await medRepo.findPrescriptionById(id);
  if (!prescription) throw new ServiceError('Prescription not found', 404);
  const residentIds = await getResidentScope(user);
  const rid = prescription.residentId?._id || prescription.residentId;
  if (!isResidentAccessible(rid, residentIds)) {
    throw new ServiceError('Access denied: resident not assigned to you', 403);
  }
  return prescription;
};

const createPrescription = async (user, body) => {
  if (user.role !== 'doctor') throw new ServiceError('Only doctors can create prescriptions', 403);
  const { residentId, medicationName, dosage, startDate } = body;
  if (!residentId || !medicationName || !dosage || !startDate) {
    throw new ServiceError('residentId, medicationName, dosage, and startDate are required', 400);
  }

  const residentIds = await getResidentScope(user);
  if (!isResidentAccessible(residentId, residentIds)) {
    throw new ServiceError('Resident is not assigned to you', 403);
  }

  const profile = await staffProfileRepo.findByUserId(user._id);
  if (!profile) throw new ServiceError('Staff profile not found', 404);

  const prescription = await medRepo.createPrescription({
    residentId,
    prescribedByStaffId: profile._id,
    medicationName: medicationName.trim(),
    dosage: dosage.trim(),
    route: body.route || 'Oral',
    frequency: body.frequency || '',
    startDate: new Date(startDate),
    endDate: body.endDate ? new Date(body.endDate) : undefined,
    scheduleTimes: body.scheduleTimes || [],
    status: 'active',
    notes: body.notes || '',
  });

  return medRepo.findPrescriptionById(prescription._id);
};

const updatePrescription = async (user, id, body) => {
  const prescription = await medRepo.findPrescriptionById(id);
  if (!prescription) throw new ServiceError('Prescription not found', 404);
  const residentIds = await getResidentScope(user);
  const rid = prescription.residentId?._id || prescription.residentId;
  if (!isResidentAccessible(rid, residentIds)) {
    throw new ServiceError('Access denied: resident not assigned to you', 403);
  }

  const EDITABLE = ['medicationName', 'dosage', 'route', 'frequency', 'scheduleTimes', 'status', 'notes'];
  const DATE_FIELDS = ['startDate', 'endDate'];

  EDITABLE.forEach((f) => { if (body[f] !== undefined) prescription[f] = body[f]; });
  DATE_FIELDS.forEach((f) => {
    if (body[f] !== undefined) prescription[f] = body[f] ? new Date(body[f]) : undefined;
  });

  await medRepo.savePrescription(prescription);
  return medRepo.findPrescriptionById(prescription._id);
};

// ── Administrations ────────────────────────────────────

const listAdministrations = async (user, query) => {
  const residentIds = await getResidentScope(user);
  let filter = {};
  if (query.residentId) filter.residentId = query.residentId;
  if (query.prescriptionId) filter.prescriptionId = query.prescriptionId;
  if (query.status) filter.status = query.status;

  // Date window: defaults to today; supports date + dateTo for range queries
  const dateStart = query.date ? new Date(query.date) : new Date();
  dateStart.setHours(0, 0, 0, 0);
  const dateEnd = query.dateTo ? new Date(query.dateTo) : new Date(dateStart);
  dateEnd.setHours(23, 59, 59, 999);
  filter.scheduledAt = { $gte: dateStart, $lte: dateEnd };

  filter = applyScope(filter, residentIds);

  const page = Math.max(1, parseInt(query.page || 1, 10));
  const limit = Math.min(500, Math.max(1, parseInt(query.limit || 200, 10)));
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    medRepo.findAdministrations(filter, { skip, limit, sort: { scheduledAt: 1 } }),
    medRepo.countAdministrations(filter),
  ]);
  return { data, total, page, limit, date: dateStart };
};

const markAdministration = async (user, id, body) => {
  if (!['nurse', 'doctor'].includes(user.role)) {
    throw new ServiceError('Only nurses or doctors can update medication status', 403);
  }
  const { status, notes } = body;
  if (!['taken', 'missed'].includes(status)) {
    throw new ServiceError('status must be "taken" or "missed"', 400);
  }

  const admin = await medRepo.findAdministrationById(id);
  if (!admin) throw new ServiceError('Medication administration record not found', 404);

  const residentIds = await getResidentScope(user);
  const rid = admin.residentId?._id || admin.residentId;
  if (!isResidentAccessible(rid, residentIds)) {
    throw new ServiceError('Access denied: resident not assigned to you', 403);
  }

  const profile = await staffProfileRepo.findByUserId(user._id);
  admin.status = status;
  admin.takenAt = status === 'taken' ? new Date() : null;
  admin.administeredByStaffId = profile?._id;
  if (notes !== undefined) admin.notes = notes;
  await medRepo.saveAdministration(admin);
  return medRepo.findAdministrationById(admin._id);
};

const getAdministrationHistory = async (user, prescriptionId) => {
  const prescription = await medRepo.findPrescriptionById(prescriptionId);
  if (!prescription) throw new ServiceError('Prescription not found', 404);
  const residentIds = await getResidentScope(user);
  const rid = prescription.residentId?._id || prescription.residentId;
  if (!isResidentAccessible(rid, residentIds)) {
    throw new ServiceError('Access denied: resident not assigned to you', 403);
  }
  return medRepo.findHistoryByPrescription(prescriptionId);
};

module.exports = {
  getMyResidents,
  listPrescriptions,
  getPrescription,
  createPrescription,
  updatePrescription,
  listAdministrations,
  markAdministration,
  getAdministrationHistory,
};

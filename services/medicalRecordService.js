const ServiceError = require('./serviceError');
const medicalRecordRepo = require('../repositories/medicalRecordRepository');
const residentRepo = require('../repositories/residentRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const paymentService = require('./paymentService');
const { createAuditLog } = require('../utils/auditLog');

const checkAbnormalVitals = (body) => {
  const {
    bloodPressureSystolic,
    bloodPressureDiastolic,
    pulse,
    temperatureCelsius,
    oxygenSaturation,
  } = body;

  // Standard vital thresholds
  if (temperatureCelsius !== undefined && (temperatureCelsius > 37.8 || temperatureCelsius < 35.0)) {
    return true; // Fever or hypothermia
  }
  if (oxygenSaturation !== undefined && oxygenSaturation < 95) {
    return true; // Hypoxia
  }
  if (bloodPressureSystolic !== undefined && (bloodPressureSystolic > 140 || bloodPressureSystolic < 90)) {
    return true; // Hypertension or hypotension
  }
  if (bloodPressureDiastolic !== undefined && (bloodPressureDiastolic > 90 || bloodPressureDiastolic < 60)) {
    return true;
  }
  if (pulse !== undefined && (pulse > 100 || pulse < 60)) {
    return true; // Tachycardia or bradycardia
  }

  return false;
};

const recordMedicalRecord = async (user, residentId, body, req) => {
  const {
    bloodPressureSystolic,
    bloodPressureDiastolic,
    pulse,
    temperatureCelsius,
    oxygenSaturation,
    bloodSugar,
    weightKg,
    heightCm,
    summary,
    bloodType,
    physicalExamination,
    laboratoryTestResults,
    urinalysisResults,
    ecgResults,
    imagingResults,
    cognitiveFunction,
    functionalStatus,
    fallRisk,
    nutritionalStatus,
    roomCost,
    medicationCost,
    careServiceCost,
    otherCost,
    paymentMethod,
    consentToPayment,
  } = body;

  if (!residentId) throw new ServiceError('Resident ID is required', 400);

  const resident = await residentRepo.findById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);

  // Find staff profile of the logged-in doctor/nurse
  const staffProfile = await staffProfileRepo.findByUserId(user._id);
  const staffProfileId = staffProfile?._id || null;

  // Evaluate abnormal signs
  const abnormalFlag = checkAbnormalVitals(body);

  let invoiceId = null;
  const costSummary = [roomCost, medicationCost, careServiceCost, otherCost].reduce((sum, value) => {
    const amount = Number(value);
    return sum + (Number.isNaN(amount) ? 0 : Math.max(0, amount));
  }, 0);

  if (consentToPayment === true || consentToPayment === 'true') {
    const invoice = await paymentService.createInvoice(user, residentId, {
      roomCost,
      medicationCost,
      careServiceCost,
      otherCost,
      paymentMethod,
      billingPeriodStart: body.billingPeriodStart,
      billingPeriodEnd: body.billingPeriodEnd,
      dueDate: body.dueDate,
    });
    invoiceId = invoice._id;
  }

  const record = await medicalRecordRepo.create({
    residentId,
    createdByStaffId: staffProfileId,
    measuredAt: new Date(),
    bloodPressureSystolic,
    bloodPressureDiastolic,
    pulse,
    temperatureCelsius,
    oxygenSaturation,
    bloodSugar,
    weightKg,
    heightCm,
    physicalExamination,
    laboratoryTestResults,
    urinalysisResults,
    ecgResults,
    imagingResults,
    cognitiveFunction,
    functionalStatus,
    fallRisk,
    nutritionalStatus,
    roomCost,
    medicationCost,
    careServiceCost,
    otherCost,
    paymentMethod,
    consentToPayment,
    invoiceId,
    abnormalFlag,
    summary,
  });

  // Automatically sync bloodType and initial health condition back to Resident profile
  if (bloodType && bloodType !== 'unknown') {
    resident.bloodType = bloodType;
  }
  if (summary) {
    resident.initialHealthCondition = summary;
  }
  await resident.save();

  // Create Audit Log
  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'RECORD_VITAL_SIGNS',
    module: 'health',
    targetEntityType: 'MedicalRecord',
    targetEntityId: record._id,
    afterData: record.toObject(),
    req,
  });

  return record;
};

const getResidentMedicalHistory = async (user, residentId, query) => {
  if (!residentId) throw new ServiceError('Resident ID is required', 400);

  const resident = await residentRepo.findById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);

  const page = Math.max(1, parseInt(query.page || 1, 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || 50, 10)));
  const skip = (page - 1) * limit;
  const { from, to } = query;

  const [data, total] = await Promise.all([
    medicalRecordRepo.findByResidentId(residentId, {
      sort: { measuredAt: -1 },
      skip,
      limit,
      from,
      to,
    }),
    medicalRecordRepo.countByResidentId(residentId, { from, to }),
  ]);

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    resident: {
      _id: resident._id,
      fullName: resident.fullName,
      residentCode: resident.residentCode,
    },
  };
};

module.exports = {
  recordMedicalRecord,
  getResidentMedicalHistory,
};

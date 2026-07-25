const ServiceError = require('./serviceError');
const medicalRecordRepo = require('../repositories/medicalRecordRepository');
const residentRepo = require('../repositories/residentRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const paymentService = require('./paymentService');
const chargeService = require('./chargeService');
const ClinicalService = require('../models/clinicalService');
const { createAuditLog } = require('../utils/auditLog');
const { assertResidentsAssignedToUser } = require('./assignedResidentService');
const notificationService = require('./notificationService');
const { BLOOD_TYPES } = require('../models/enums');

const VITAL_FIELDS = [
  'bloodPressureSystolic',
  'bloodPressureDiastolic',
  'pulse',
  'temperatureCelsius',
  'oxygenSaturation',
  'bloodSugar',
  'weightKg',
  'heightCm',
];

const VITAL_RANGES = {
  bloodPressureSystolic: { min: 60, max: 260 },
  bloodPressureDiastolic: { min: 30, max: 160 },
  pulse: { min: 30, max: 220 },
  temperatureCelsius: { min: 30, max: 45 },
  oxygenSaturation: { min: 0, max: 100 },
  bloodSugar: { min: 20, max: 800 },
  weightKg: { min: 1, max: 300 },
  heightCm: { min: 30, max: 250 },
};

const assertVitalsValid = (body) => {
  const hasAnyVital = VITAL_FIELDS.some((field) => body[field] !== undefined && body[field] !== null && body[field] !== '');
  if (!hasAnyVital) {
    throw new ServiceError('At least one vital sign field must be provided', 400);
  }
  for (const field of VITAL_FIELDS) {
    const value = body[field];
    if (value === undefined || value === null || value === '') continue;
    const num = Number(value);
    if (Number.isNaN(num)) {
      throw new ServiceError(`${field} must be a number`, 400);
    }
    const range = VITAL_RANGES[field];
    if (num < range.min || num > range.max) {
      throw new ServiceError(`${field} must be between ${range.min} and ${range.max}`, 400);
    }
  }
  const systolic = Number(body.bloodPressureSystolic);
  const diastolic = Number(body.bloodPressureDiastolic);
  if (!Number.isNaN(systolic) && !Number.isNaN(diastolic) && body.bloodPressureSystolic !== undefined && body.bloodPressureDiastolic !== undefined) {
    if (diastolic >= systolic) {
      throw new ServiceError('bloodPressureDiastolic must be lower than bloodPressureSystolic', 400);
    }
  }
  if (body.bloodType !== undefined && body.bloodType !== null && body.bloodType !== '' && !BLOOD_TYPES.includes(body.bloodType)) {
    throw new ServiceError(`bloodType must be one of: ${BLOOD_TYPES.join(', ')}`, 400);
  }
  if (typeof body.summary === 'string' && body.summary.length > 500) {
    throw new ServiceError('summary must be at most 500 characters', 400);
  }
};

const { uploadImageBuffer } = require('../utils/cloudinaryUpload');

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

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeNumber = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const normalizePhysicalExamination = (value) => {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? { summary: trimmed } : undefined;
  }
  return {
    general: normalizeString(value.general),
    cardiovascular: normalizeString(value.cardiovascular),
    respiratory: normalizeString(value.respiratory),
    abdominal: normalizeString(value.abdominal),
    neurological: normalizeString(value.neurological),
    musculoskeletal: normalizeString(value.musculoskeletal),
    skin: normalizeString(value.skin),
    other: normalizeString(value.other),
    summary: normalizeString(value.summary),
  };
};

const normalizeLabResults = (value) => {
  if (!value) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [{ testName: 'Tổng quan', result: trimmed, unit: '', referenceRange: '', notes: '' }] : [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      testName: normalizeString(item.testName),
      result: normalizeString(item.result),
      unit: normalizeString(item.unit),
      referenceRange: normalizeString(item.referenceRange),
      notes: normalizeString(item.notes),
    }))
    .filter((item) => item.testName || item.result || item.notes);
};

const normalizeUrinalysisResults = (value) => {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? { notes: trimmed } : undefined;
  }
  return {
    appearance: normalizeString(value.appearance),
    color: normalizeString(value.color),
    pH: normalizeNumber(value.pH),
    specificGravity: normalizeNumber(value.specificGravity),
    protein: normalizeString(value.protein),
    glucose: normalizeString(value.glucose),
    ketones: normalizeString(value.ketones),
    blood: normalizeString(value.blood),
    leukocyteEsterase: normalizeString(value.leukocyteEsterase),
    nitrites: normalizeString(value.nitrites),
    urobilinogen: normalizeString(value.urobilinogen),
    bilirubin: normalizeString(value.bilirubin),
    microscopy: normalizeString(value.microscopy),
    notes: normalizeString(value.notes),
  };
};

const normalizeECGResults = (value) => {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? { interpretation: trimmed } : undefined;
  }
  return {
    heartRate: normalizeNumber(value.heartRate),
    rhythm: normalizeString(value.rhythm),
    prInterval: normalizeString(value.prInterval),
    qrsDuration: normalizeString(value.qrsDuration),
    qtInterval: normalizeString(value.qtInterval),
    axis: normalizeString(value.axis),
    interpretation: normalizeString(value.interpretation),
    notes: normalizeString(value.notes),
  };
};

const normalizeImagingResults = (value) => {
  if (!value) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [{ modality: '', bodyPart: '', finding: '', impression: '', imageUrls: [], cloudinaryPublicIds: [], notes: trimmed }] : [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      modality: normalizeString(item.modality),
      bodyPart: normalizeString(item.bodyPart),
      finding: normalizeString(item.finding),
      impression: normalizeString(item.impression),
      imageUrls: Array.isArray(item.imageUrls) ? item.imageUrls.map(normalizeString).filter(Boolean) : [],
      cloudinaryPublicIds: Array.isArray(item.cloudinaryPublicIds) ? item.cloudinaryPublicIds.map(normalizeString).filter(Boolean) : [],
      notes: normalizeString(item.notes),
    }))
    .filter((item) => item.modality || item.bodyPart || item.finding || item.impression || item.notes);
};

const normalizeCognitiveFunction = (value) => {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? { notes: trimmed } : undefined;
  }
  return {
    assessmentTool: normalizeString(value.assessmentTool),
    score: normalizeString(value.score),
    orientation: normalizeString(value.orientation),
    memory: normalizeString(value.memory),
    attention: normalizeString(value.attention),
    language: normalizeString(value.language),
    executiveFunction: normalizeString(value.executiveFunction),
    notes: normalizeString(value.notes),
  };
};

const normalizeFunctionalStatus = (value) => {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? { notes: trimmed } : undefined;
  }
  return {
    mobility: normalizeString(value.mobility),
    transfers: normalizeString(value.transfers),
    adls: normalizeString(value.adls),
    iadls: normalizeString(value.iadls),
    assistanceRequired: normalizeString(value.assistanceRequired),
    notes: normalizeString(value.notes),
  };
};

const normalizeFallRisk = (value) => {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const level = normalizeString(value).toLowerCase();
    return {
      level: ['low', 'medium', 'high'].includes(level) ? level : undefined,
      notes: normalizeString(value),
    };
  }
  return {
    level: ['low', 'medium', 'high'].includes(normalizeString(value.level).toLowerCase()) ? normalizeString(value.level).toLowerCase() : undefined,
    historyOfFalls: value.historyOfFalls === true || value.historyOfFalls === 'true',
    gait: normalizeString(value.gait),
    balance: normalizeString(value.balance),
    medications: normalizeString(value.medications),
    vision: normalizeString(value.vision),
    cognition: normalizeString(value.cognition),
    notes: normalizeString(value.notes),
  };
};

const normalizeNutritionalStatus = (value) => {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? { notes: trimmed } : undefined;
  }
  return {
    bmi: normalizeNumber(value.bmi),
    weightChange: normalizeString(value.weightChange),
    appetite: normalizeString(value.appetite),
    dietType: normalizeString(value.dietType),
    swallowing: normalizeString(value.swallowing),
    proteinIntake: normalizeString(value.proteinIntake),
    hydration: normalizeString(value.hydration),
    notes: normalizeString(value.notes),
  };
};

const mongoose = require('mongoose');

const normalizeServiceFieldValues = (values) => {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
  const result = {};
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      result[key] = value.map((item) => String(item || '').trim()).filter(Boolean);
    } else if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized.includes(',')) {
        result[key] = normalized.split(',').map((item) => item.trim()).filter(Boolean);
      } else {
        result[key] = normalized;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
};

const buildSelectedServiceFilesMap = (files = []) => {
  const result = {};
  for (const file of files || []) {
    if (!file || !file.fieldname) continue;
    const match = file.fieldname.match(/^serviceFile_([^_]+)_(.+)$/);
    if (!match) continue;
    const serviceId = match[1];
    const fieldCode = match[2];
    if (!result[serviceId]) result[serviceId] = {};
    if (!result[serviceId][fieldCode]) result[serviceId][fieldCode] = [];
    result[serviceId][fieldCode].push(file);
  }
  return result;
};

const uploadSelectedServiceImages = async (selectedServices = [], files = [], residentId) => {
  const fileMap = buildSelectedServiceFilesMap(files);
  const result = [];
  for (const service of selectedServices) {
    const serviceKey = String(service.serviceId || service.serviceCode || '');
    const serviceFiles = fileMap[serviceKey] || {};
    if (Object.keys(serviceFiles).length > 0) {
      service.fieldValues = service.fieldValues || {};
      for (const [fieldCode, fileList] of Object.entries(serviceFiles)) {
        const uploadedUrls = [];
        for (const file of fileList) {
          if (!file || !file.mimetype || !file.mimetype.startsWith('image/')) continue;
          const result = await uploadImageBuffer(file.buffer, {
            folder: `nursing-home/medical-records/${residentId}/${serviceKey}/${fieldCode}`,
            mimeType: file.mimetype,
          });
          if (result?.secure_url) {
            uploadedUrls.push(result.secure_url);
          }
        }
        if (uploadedUrls.length > 0) {
          const existing = service.fieldValues[fieldCode];
          if (Array.isArray(existing)) {
            service.fieldValues[fieldCode] = existing.concat(uploadedUrls);
          } else if (existing) {
            service.fieldValues[fieldCode] = [existing, ...uploadedUrls];
          } else {
            service.fieldValues[fieldCode] = uploadedUrls;
          }
        }
      }
    }
    result.push(service);
  }
  return result;
};

const normalizeSelectedServices = (services) => {
  if (!Array.isArray(services)) return [];
  return services.map((s) => ({
    serviceId: (s.serviceId || s._id) && mongoose.Types.ObjectId.isValid(s.serviceId || s._id) ? (s.serviceId || s._id) : undefined,
    serviceCode: String(s.serviceCode || '').trim(),
    serviceName: String(s.serviceName || '').trim(),
    quantity: Math.max(1, Number(s.quantity) || 1),
    unitPrice: Math.max(0, Number(s.unitPrice) || 0),
    fieldValues: normalizeServiceFieldValues(s.fieldValues),
  }));
};

const getServiceFieldThresholds = (field, gender) => {
  if (!field || field.type !== 'NUMBER') return { min: null, max: null };

  const normalizedGender = gender === 'male' || gender === 'M' || gender === 'nam' ? 'male'
    : gender === 'female' || gender === 'F' || gender === 'nữ' || gender === 'nu' ? 'female'
    : null;

  if (normalizedGender === 'male') {
    const maleMin = field.maleMin !== undefined && field.maleMin !== null && field.maleMin !== '' ? Number(field.maleMin) : null;
    const maleMax = field.maleMax !== undefined && field.maleMax !== null && field.maleMax !== '' ? Number(field.maleMax) : null;
    if (maleMin !== null || maleMax !== null) {
      return { min: maleMin, max: maleMax };
    }
  }

  if (normalizedGender === 'female') {
    const femaleMin = field.femaleMin !== undefined && field.femaleMin !== null && field.femaleMin !== '' ? Number(field.femaleMin) : null;
    const femaleMax = field.femaleMax !== undefined && field.femaleMax !== null && field.femaleMax !== '' ? Number(field.femaleMax) : null;
    if (femaleMin !== null || femaleMax !== null) {
      return { min: femaleMin, max: femaleMax };
    }
  }

  const min = field.min !== undefined && field.min !== null && field.min !== '' ? Number(field.min) : null;
  const max = field.max !== undefined && field.max !== null && field.max !== '' ? Number(field.max) : null;
  return { min, max };
};

const checkAbnormalSelectedServiceFields = async (selectedServices = [], gender) => {
  const serviceIds = selectedServices
    .map((s) => (s.serviceId && mongoose.Types.ObjectId.isValid(s.serviceId) ? s.serviceId : null))
    .filter(Boolean);

  if (!serviceIds.length) return false;

  const services = await ClinicalService.find({ _id: { $in: serviceIds } }).lean();
  const serviceMap = new Map(services.map((svc) => [String(svc._id), svc]));

  for (const selectedService of selectedServices) {
    const serviceSchema = selectedService.serviceId ? serviceMap.get(String(selectedService.serviceId)) : null;
    if (!serviceSchema || !Array.isArray(serviceSchema.fields)) continue;

    for (const field of serviceSchema.fields) {
      if (field.type !== 'NUMBER') continue;
      const rawValue = selectedService.fieldValues?.[field.fieldCode];
      if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') continue;
      const parsed = Number(rawValue);
      if (Number.isNaN(parsed)) continue;

      const { min, max } = getServiceFieldThresholds(field, gender);
      if (min !== null && parsed < min) return true;
      if (max !== null && parsed > max) return true;
    }
  }

  return false;
};

const buildHealthMonitoringNotificationPayload = ({ resident, record, user }) => {
  const residentName = resident?.fullName || 'bệnh nhân';
  const doctorName = user?.fullName || user?.name || 'Bác sĩ';
  const services = Array.isArray(record?.selectedServices)
    ? record.selectedServices.map((item) => item?.serviceName || item?.serviceCode).filter(Boolean)
    : [];
  const summary = typeof record?.summary === 'string' ? record.summary.trim() : '';
  const details = [];

  if (record?.abnormalFlag) details.push('có chỉ số bất thường');
  if (services.length) details.push(`đã cập nhật dịch vụ: ${services.join(', ')}`);
  if (summary) details.push(`ghi chú: ${summary}`);

  return {
    category: 'health',
    title: `Cập nhật sức khỏe: ${residentName}`,
    content: [
      `Bác sĩ ${doctorName} vừa cập nhật tình trạng sức khỏe của ${residentName}.`,
      details.length ? `Thông tin nổi bật: ${details.join('; ')}.` : 'Vui lòng xem chi tiết trong hồ sơ sức khỏe của người thân.',
    ].join(' '),
    targetEntityType: 'MedicalRecord',
    targetEntityId: record?._id,
    deliveryChannels: ['in_app'],
    sentAt: new Date(),
  };
};

const notifyFamilyAboutHealthMonitoringUpdate = async ({ resident, record, user }) => {
  if (!resident?._id || !record?._id) return;

  const recipientUserIds = [...new Set((resident.familyPortalAccountIds || [])
    .map((id) => (id ? id.toString() : ''))
    .filter(Boolean))];

  if (!recipientUserIds.length) return;

  try {
    const payload = buildHealthMonitoringNotificationPayload({ resident, record, user });
    const notifications = recipientUserIds.map((recipientUserId) => ({
      ...payload,
      recipientUserId: new mongoose.Types.ObjectId(recipientUserId),
    }));

    await notificationService.createMany(notifications);
  } catch (error) {
    console.error('[medicalRecordService] Failed creating family health notifications', error.message || error);
  }
};

const recordMedicalRecord = async (user, residentId, body, req) => {
  if (!residentId || !mongoose.Types.ObjectId.isValid(residentId)) {
    throw new ServiceError('Resident ID không hợp lệ', 400);
  }

  if (user.role === 'caregiver') {
    await assertResidentsAssignedToUser(user._id, [residentId]);
  }

  assertVitalsValid(body);

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
    selectedServices,
  } = body;

  if (!residentId) throw new ServiceError('Resident ID is required', 400);

  const resident = await residentRepo.findById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);

  // Find staff profile of the logged-in doctor/nurse
  const staffProfile = await staffProfileRepo.findByUserId(user._id);
  const staffProfileId = staffProfile?._id || null;

  // Evaluate abnormal signs
  const fileUploads = Array.isArray(req.files) ? req.files : [];
  const uploadedSelectedServices = await uploadSelectedServiceImages(selectedServices, fileUploads, residentId);
  const normalizedSelectedServices = normalizeSelectedServices(uploadedSelectedServices);
  const serviceFieldsAbnormal = await checkAbnormalSelectedServiceFields(normalizedSelectedServices, resident.gender);
  const abnormalFlag = checkAbnormalVitals(body) || serviceFieldsAbnormal;

  let invoiceId = null;
  const costSummary = [roomCost, medicationCost, careServiceCost, otherCost].reduce((sum, value) => {
    const amount = Number(value);
    return sum + (Number.isNaN(amount) ? 0 : Math.max(0, amount));
  }, 0);

  // if consentToPayment and no selected services, create legacy invoice (room/meds/etc)
  if (!(body.selectedServices && Array.isArray(body.selectedServices) && body.selectedServices.length > 0) && (consentToPayment === true || consentToPayment === 'true')) {
    // legacy invoice creation (room/medication/care/other)
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
    physicalExamination: normalizePhysicalExamination(physicalExamination),
    laboratoryTestResults: normalizeLabResults(laboratoryTestResults),
    urinalysisResults: normalizeUrinalysisResults(urinalysisResults),
    ecgResults: normalizeECGResults(ecgResults),
    imagingResults: normalizeImagingResults(imagingResults),
    cognitiveFunction: normalizeCognitiveFunction(cognitiveFunction),
    functionalStatus: normalizeFunctionalStatus(functionalStatus),
    fallRisk: normalizeFallRisk(fallRisk),
    nutritionalStatus: normalizeNutritionalStatus(nutritionalStatus),
    selectedServices: normalizedSelectedServices,
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

  if (abnormalFlag) {
    try {
      const recipientIds = new Set();
      (resident.familyPortalAccountIds || []).forEach((id) => recipientIds.add(id.toString()));
      const assignedStaff = await staffProfileRepo.findByAssignedResidentId(residentId);
      assignedStaff.forEach((profile) => {
        const staffUser = profile.userId;
        if (staffUser && ['doctor', 'nurse'].includes(staffUser.role) && staffUser._id.toString() !== user._id.toString()) {
          recipientIds.add(staffUser._id.toString());
        }
      });
      if (recipientIds.size > 0) {
        const title = `Chỉ số sinh hiệu bất thường - ${resident.fullName || resident.residentCode}`;
        const content = `Ghi nhận chỉ số sinh hiệu bất thường cho ${resident.fullName || 'cư dân'} lúc ${new Date().toLocaleString('vi-VN')}. Vui lòng kiểm tra chi tiết.`;
        const notificationDocs = Array.from(recipientIds).map((recipientUserId) => ({
          recipientUserId,
          category: 'health',
          title,
          content,
          targetEntityType: 'MedicalRecord',
          targetEntityId: record._id,
          deliveryChannels: ['in_app'],
        }));
        await notificationService.createMany(notificationDocs);
      }
    } catch (err) {
      console.error('Failed to create abnormal vitals notification:', err.message || err);
    }
  }

  // If selectedServices provided, create charges (with origin linked to this record) and invoice for them
  if (body.selectedServices && Array.isArray(body.selectedServices) && body.selectedServices.length > 0 && (consentToPayment === true || consentToPayment === 'true')) {
    console.log('[medicalRecordService] Creating charges for resident:', residentId, 'Services:', body.selectedServices.length);
    const createdCharges = [];
    for (const s of body.selectedServices) {
      try {
        const charge = await chargeService.createChargeForRecord({
          originType: 'MedicalRecord',
          originId: record._id,
          residentId,
          serviceCode: s.serviceCode,
          serviceName: s.serviceName,
          category: 'CLINICAL_SERVICE',
          performedById: user._id,
          performedBy: user.fullName || user.name || user.email || '',
          performedAt: new Date(),
          quantity: s.quantity || 1,
          unitPrice: s.unitPrice || 0,
        });
        if (charge) {
          console.log('[medicalRecordService] Charge created successfully:', charge._id);
          createdCharges.push(charge);
        }
      } catch (err) {
        console.error('[medicalRecordService] Failed creating charge for selected service:', s.serviceName, err.message || err);
      }
    }
    console.log('[medicalRecordService] Total charges created:', createdCharges.length);

    const items = createdCharges.map((c) => ({
      chargeId: c._id,
      description: c.serviceName || c.serviceCode,
      amount: c.totalPrice || ((c.unitPrice || 0) * (c.quantity || 1)),
      category: 'SERVICE',
    }));

    // Charges are created in PENDING state here. Invoice creation is deferred until an admin
    // explicitly generates the invoice for these clinical service charges.
    if (items.length) {
      console.log(
        `[medicalRecordService] Created ${items.length} service charge(s) for resident ${residentId}; invoice generation deferred.`
      );
    }
  }

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

  await notifyFamilyAboutHealthMonitoringUpdate({ resident, record, user });

  return record;
};

const getResidentMedicalHistory = async (user, residentId, query) => {
  if (!residentId) throw new ServiceError('Resident ID is required', 400);

  if (user.role === 'caregiver') {
    await assertResidentsAssignedToUser(user._id, [residentId]);
  }

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
  buildHealthMonitoringNotificationPayload,
  recordMedicalRecord,
  getResidentMedicalHistory,
};

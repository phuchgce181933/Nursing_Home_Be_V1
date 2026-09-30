const { isValidObjectId, Types } = require('mongoose');
const ServiceError = require('./serviceError');
const prescriptionRepo = require('../repositories/prescriptionRepository');
const medicationScheduleRepo = require('../repositories/medicationScheduleRepository');
const medicationRepo = require('../repositories/medicationRepository');
const medicationStockRepo = require('../repositories/medicationStockRepository');
const medicationDispenseRepo = require('../repositories/medicationDispenseRepository');
const { getResidentScope, isInScope } = require('./residentScopeHelper');
const {
  checkAllergies,
  checkContraindications,
  checkDrugInteractions,
  checkElderlyDosage,
  checkDuplicatePrescriptions,
} = require('./medicationSafetyService');
const {
  generateSchedules,
  generateSchedulesForItem,
} = require('./scheduleGeneratorService');
const { createAuditLog } = require('../utils/auditLog');

const residentRepo = require('../repositories/residentRepository');

const ACK_REQUIRED_INTERACTION = new Set(['SEVERE']);
const ACK_REQUIRED_CONTRAINDICATION = new Set(['HIGH', 'CRITICAL']);
const ACK_REQUIRED_DOSAGE = new Set(['HIGH', 'CRITICAL']);

const hasSevereWarning = (contraWarnings, interactionWarnings, dosageWarnings = []) =>
  interactionWarnings.some((w) => ACK_REQUIRED_INTERACTION.has(w.severity)) ||
  contraWarnings.some((w) => ACK_REQUIRED_CONTRAINDICATION.has(w.severity)) ||
  dosageWarnings.some((w) => ACK_REQUIRED_DOSAGE.has(w.severity));

const resolveMedicationsFromDB = async (items) => {
  const allIds = items.map((i) => String(i.medicationId));
  const seen = new Set();
  const duplicates = new Set();
  for (const id of allIds) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size) {
    throw new ServiceError(
      `Thuốc bị trùng lặp trong items: mỗi loại thuốc chỉ được xuất hiện một lần trong đơn thuốc (medicationId: ${[...duplicates].join(', ')})`,
      400
    );
  }

  const ids = [...seen];
  const meds = await medicationRepo.findByIds(ids);
  const activeMeds = meds.filter((m) => m.isActive !== false);
  if (activeMeds.length !== ids.length) {
    const foundIds = new Set(activeMeds.map((m) => m._id.toString()));
    const missing = ids.filter((id) => !foundIds.has(id));
    throw new ServiceError(
      `Không tìm thấy thuốc trong cơ sở dữ liệu dược phẩm hoặc thuốc đã ngừng hoạt động: ${missing.join(', ')}`,
      400
    );
  }
  return new Map(activeMeds.map((m) => [m._id.toString(), m]));
};

const findOutOfStockMedications = async (items) => {
  const medicationIds = [...new Set(items.map((item) => String(item.medicationId)))];
  const medicationObjectIds = medicationIds.map((id) => new Types.ObjectId(id));
  const [stockTotals, dispenseTotals, activePrescriptions] = await Promise.all([
    medicationStockRepo.sumQuantitiesByMedicationIds(medicationObjectIds),
    medicationDispenseRepo.sumQuantitiesByMedicationIds(medicationObjectIds),
    prescriptionRepo.findByFilter(
      { status: 'ACTIVE', 'items.medicationId': { $in: medicationObjectIds } },
      { select: 'items.medicationId items.quantity items.isActive' }
    ),
  ]);
  const stockMap = new Map(stockTotals.map((row) => [String(row._id), row.total || 0]));
  const dispenseMap = new Map(dispenseTotals.map((row) => [String(row._id), row.total || 0]));
  const reservedMap = new Map();
  activePrescriptions.forEach((prescription) => {
    (prescription.items || []).forEach((item) => {
      if (item.isActive === false) return;
      const medicationId = String(item.medicationId);
      reservedMap.set(
        medicationId,
        (reservedMap.get(medicationId) || 0) + (Number(item.quantity) || 0)
      );
    });
  });

  const availability = medicationIds
    .map((id) => {
      const requestedQuantity = items
        .filter((item) => String(item.medicationId) === id)
        .reduce((total, item) => total + (Number(item.quantity) || 0), 0);
      return {
        id,
        requestedQuantity,
        stockTotal: stockMap.get(id) || 0,
        dispensedTotal: dispenseMap.get(id) || 0,
        reservedQuantity: reservedMap.get(id) || 0,
      };
    })
    .map((entry) => ({
      ...entry,
      available: entry.stockTotal - entry.dispensedTotal - entry.reservedQuantity,
    }))
    .filter((entry) => entry.available < entry.requestedQuantity);

  console.log('[PRESCRIPTION_DEBUG] stock availability', {
    requestedMedicationIds: medicationIds,
    stockTotals: Object.fromEntries(stockMap),
    dispensedTotals: Object.fromEntries(dispenseMap),
    reservedTotals: Object.fromEntries(reservedMap),
    availability,
  });

  return availability;
};

// ── createPrescription ───────────────────────────────────────────────────────

const createPrescription = async ({ body, user, req }) => {
  const { residentId, diagnosisNote, validUntil, items, acknowledgeWarnings, saveAsDraft, acknowledgeDuplicates } = body;

  console.log('[PRESCRIPTION_DEBUG] create request', {
    userId: user?._id,
    role: user?.role,
    residentId,
    validUntil,
    itemCount: Array.isArray(items) ? items.length : undefined,
    items: Array.isArray(items)
      ? items.map((item) => ({
        medicationId: item.medicationId,
        dosage: item.dosage,
        frequency: item.frequency,
        timesCount: Array.isArray(item.times) ? item.times.length : undefined,
        isPRN: item.isPRN,
        duration: item.duration,
        startDate: item.startDate,
      }))
      : undefined,
  });

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(residentId, scope)) {
    throw new ServiceError('Cư dân không được phân công cho bạn', 403);
  }

  const resident = await residentRepo.findById(residentId);
  if (!resident) {
    throw new ServiceError('Không tìm thấy cư dân', 404);
  }
  const residentFullName = resident.fullName || resident.profile?.fullName || resident.profile?.fullname || String(residentId);

  if (resident.residencyStatus !== 'admitted') {
    throw new ServiceError('Cư dân hiện chưa được tiếp nhận', 400);
  }

  const medMap = await resolveMedicationsFromDB(items);
  const outOfStockMedications = await findOutOfStockMedications(items);
  if (outOfStockMedications.length) {
    const details = outOfStockMedications
      .map((entry) => `${medMap.get(entry.id)?.name || entry.id} (cần ${entry.requestedQuantity}, còn ${Math.max(0, entry.available)})`)
      .join('; ');
    throw new ServiceError(`Không thể kê đơn vì số lượng thuốc vượt quá tồn kho: ${details}`, 400);
  }
  const drugNames = items.map((i) => medMap.get(String(i.medicationId)).name);

  const { allergies: allergyHits } = await checkAllergies(residentId, drugNames);
  if (allergyHits.length) {
    return {
      blocked: true,
      statusCode: 400,
      payload: {
        success: false,
        errorCode: 'ALLERGY',
        detail: allergyHits,
        requiresAcknowledgment: false,
      },
    };
  }

  const dosageItems = items.filter((i) => !i.isPRN).map((i) => ({
    medicationName: medMap.get(String(i.medicationId)).name,
    dosage: Number(i.dosage),
    frequency: Number(i.frequency),
    unit: medMap.get(String(i.medicationId)).unit,
  }));

  const [contraResult, interactResult, dosageResult, duplicateResult] = await Promise.all([
    checkContraindications(residentId, drugNames),
    checkDrugInteractions(residentId, drugNames),
    dosageItems.length ? checkElderlyDosage(residentId, dosageItems) : { warnings: [] },
    checkDuplicatePrescriptions(residentId, drugNames),
  ]);

  const contraWarnings = contraResult.violations;
  const interactionWarnings = interactResult.interactions;
  const dosageWarnings = dosageResult.warnings;
  const duplicateWarnings = duplicateResult.duplicates;

  const allWarnings = [
    ...contraWarnings.map((w) => ({ type: 'CONTRAINDICATION', ...w })),
    ...interactionWarnings.map((w) => ({ type: 'DRUG_INTERACTION', ...w })),
    ...dosageWarnings.map((w) => ({ type: 'ELDERLY_DOSAGE', ...w })),
    ...duplicateWarnings.map((w) => ({ type: 'DUPLICATE_PRESCRIPTION', ...w })),
  ];

  if (hasSevereWarning(contraWarnings, interactionWarnings, dosageWarnings) && !acknowledgeWarnings) {
    return {
      blocked: true,
      statusCode: 400,
      payload: {
        success: false,
        errorCode: 'REQUIRES_ACKNOWLEDGMENT',
        warnings: allWarnings,
        requiresAcknowledgment: true,
      },
    };
  }

  if (duplicateWarnings.length && !acknowledgeDuplicates && !acknowledgeWarnings) {
    return {
      blocked: true,
      statusCode: 400,
      payload: {
        success: false,
        errorCode: 'DUPLICATE_WARNING',
        warnings: allWarnings,
        duplicates: duplicateWarnings,
        requiresAcknowledgment: true,
      },
    };
  }

  const acknowledgments = [];
  if ((acknowledgeWarnings || acknowledgeDuplicates) && allWarnings.length) {
    const uniqueTypes = [...new Set(allWarnings.map((w) => w.type))];
    for (const warningType of uniqueTypes) {
      acknowledgments.push({
        warningType,
        acknowledgedBy: user._id,
        acknowledgedAt: new Date(),
      });
    }
  }

  const overdosedDrugs = new Set(dosageWarnings.map((w) => w.medicationName));
  const initialStatus = saveAsDraft ? 'DRAFT' : 'ACTIVE';

  const prescription = await prescriptionRepo.create({
    residentId,
    doctorId: user._id,
    diagnosisNote,
    prescriptionDate: new Date(),
    validUntil: new Date(validUntil),
    status: initialStatus,
    version: 1,
    activatedAt: initialStatus === 'ACTIVE' ? new Date() : undefined,
    activatedBy: initialStatus === 'ACTIVE' ? user._id : undefined,
    items: items.map((item) => {
      const med = medMap.get(String(item.medicationId));
      const quantity = Number(item.quantity) || 1;
      const price = Number(item.price) || 0;
      const taxRate = Number(item.taxRate) || 0.05;
      const subtotalExclTax = Number(item.subtotalExclTax) || (price * quantity);
      const taxAmount = Number(item.taxAmount) || (subtotalExclTax * taxRate);
      const subtotalInclTax = Number(item.subtotalInclTax) || (subtotalExclTax + taxAmount);

      return {
        medicationId: med._id,
        medicationName: med.name,
        genericName: item.genericName || med.genericName || null,
        dosage: String(item.dosage),
        unit: med.unit || null,
        quantity,
        price,
        taxRate,
        subtotalExclTax: Math.round(subtotalExclTax * 100) / 100,
        taxAmount: Math.round(taxAmount * 100) / 100,
        subtotalInclTax: Math.round(subtotalInclTax * 100) / 100,
        frequency: item.isPRN ? (item.frequency || 1) : Number(item.frequency),
        times: item.isPRN ? [] : (Array.isArray(item.times) ? item.times : []),
        route: item.route || 'oral',
        duration: item.duration,
        startDate: item.startDate ? new Date(item.startDate) : undefined,
        endDate: item.endDate ? new Date(item.endDate) : undefined,
        instructions: item.instructions,
        elderlyDosageAdjusted: overdosedDrugs.has(med.name),
        isActive: true,
        isPRN: !!item.isPRN,
        prnReason: item.isPRN ? item.prnReason : undefined,
        maxDailyDoses: item.isPRN ? item.maxDailyDoses : undefined,
      };
    }),
    acknowledgments,
  });

  if (initialStatus === 'ACTIVE') {
    await generateSchedules(prescription);
  }

  const medicationSummary = prescription.items.map((item) => `${item.medicationName} (${item.dosage}${item.unit ? ' ' + item.unit : ''})`).join(', ');

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'CREATE_PRESCRIPTION',
    module: 'prescription',
    targetEntityType: 'Prescription',
    targetEntityId: prescription._id,
    targetName: `Đơn thuốc cho ${residentFullName} - ${medicationSummary}`,
    afterData: {
      status: initialStatus,
      diagnosisNote: prescription.diagnosisNote,
      validUntil: prescription.validUntil,
      residentId: String(prescription.residentId),
      residentName: residentFullName,
      items: prescription.items.map((item) => ({
        medicationName: item.medicationName,
        dosage: item.dosage,
        unit: item.unit,
        frequency: item.frequency,
        times: item.times,
        route: item.route,
        duration: item.duration,
        instructions: item.instructions,
        isPRN: item.isPRN,
      })),
    },
    description: `Tạo đơn thuốc "${initialStatus}" cho cư dân "${residentFullName}" - ${items.length} loại thuốc: ${medicationSummary}`,
    req,
  });

  return { blocked: false, data: prescription, warnings: allWarnings };
};

// ── editPrescription ─────────────────────────────────────────────────────────

const editPrescription = async ({ id, body, user, req }) => {
  if (!isValidObjectId(id)) {
    throw new ServiceError('ID đơn thuốc không hợp lệ', 400);
  }

  const role = user.role;
  const { diagnosisNote, validUntil, items, acknowledgeWarnings, status } = body;

  const prescription = await prescriptionRepo.findById(id);
  if (!prescription) {
    throw new ServiceError('Không tìm thấy đơn thuốc', 404);
  }
  if (!['ACTIVE', 'DRAFT'].includes(prescription.status)) {
    throw new ServiceError('Chỉ có thể chỉnh sửa đơn thuốc ở trạng thái ACTIVE hoặc DRAFT', 400);
  }

  const scope = await getResidentScope(user._id, role);
  if (!isInScope(prescription.residentId, scope)) {
    throw new ServiceError('Cư dân không được phân công cho bạn', 403);
  }

  const changeLog = [];
  let allWarnings = [];

  if (role === 'nurse') {
    return _editAsNurse({ prescription, items, user, req });
  }

  // ── Doctor: full edit
  if (diagnosisNote !== undefined && diagnosisNote !== prescription.diagnosisNote) {
    changeLog.push('Updated diagnosisNote');
    prescription.diagnosisNote = diagnosisNote;
  }

  if (validUntil !== undefined) {
    const newUntil = new Date(validUntil);
    if (newUntil.getTime() !== prescription.validUntil.getTime()) {
      changeLog.push(`Updated validUntil to ${newUntil.toISOString().slice(0, 10)}`);
      prescription.validUntil = newUntil;
    }
  }

  if (status !== undefined && status !== prescription.status) {
    const ALLOWED_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'];
    if (!ALLOWED_STATUSES.includes(status)) {
      throw new ServiceError(`status phải thuộc một trong: ${ALLOWED_STATUSES.join(', ')}`, 400);
    }
    const prevStatus = prescription.status;
    changeLog.push(`Changed status from ${prevStatus} to ${status}`);
    prescription.status = status;
    if (status === 'CANCELLED') {
      await medicationScheduleRepo.updateManyByFilter(
        { prescriptionId: prescription._id, status: { $in: ['PENDING', 'OVERDUE'] } },
        { $set: { status: 'DISCONTINUED' } }
      );
    }
  }

  if (Array.isArray(items) && items.length) {
    const itemResult = await _processDoctorItems({ prescription, items, acknowledgeWarnings, changeLog, user });
    if (itemResult.blocked) return itemResult;
    allWarnings = itemResult.allWarnings;
  }

  if (!changeLog.length) {
    return { blocked: false, noChanges: true, data: prescription, warnings: allWarnings };
  }

  const beforeSnapshot = {
    items: prescription.items.map((i) => i.toObject()),
    status: prescription.status,
    diagnosisNote: prescription.diagnosisNote,
    validUntil: prescription.validUntil,
  };

  prescription.version = (prescription.version || 1) + 1;
  prescription.editHistory.push({
    editedBy: user._id,
    editedAt: new Date(),
    changes: changeLog.join('; '),
    action: 'EDIT',
    beforeData: beforeSnapshot,
  });

  await prescriptionRepo.saveDoc(prescription);

  if (Array.isArray(items) && items.length) {
    await generateSchedules(prescription);
  }

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'EDIT_PRESCRIPTION',
    module: 'prescription',
    targetEntityType: 'Prescription',
    targetEntityId: prescription._id,
    beforeData: beforeSnapshot,
    afterData: {
      changes: changeLog,
      version: prescription.version,
      diagnosisNote: prescription.diagnosisNote,
      validUntil: prescription.validUntil,
      status: prescription.status,
    },
    description: `Chỉnh sửa đơn thuốc v${prescription.version}: ${changeLog.join('; ')}`,
    req,
  });

  const populated = await prescriptionRepo.findByIdListPopulated(prescription._id);
  return { blocked: false, data: populated, warnings: allWarnings };
};

// ── Nurse edit (times + instructions only) ───────────────────────────────────

const _editAsNurse = async ({ prescription, items, user, req }) => {
  if (!Array.isArray(items) || !items.length) {
    throw new ServiceError('Chỉnh sửa của điều dưỡng yêu cầu items[] kèm tham chiếu _id của item', 400);
  }

  for (const patch of items) {
    const existing = prescription.items.id(patch._id);
    if (!existing) {
      throw new ServiceError(`Không tìm thấy _id ${patch._id} trong đơn thuốc này`, 400);
    }
    if (
      patch.times !== undefined &&
      (!Array.isArray(patch.times) || !patch.times.length || patch.times.length !== existing.frequency)
    ) {
      throw new ServiceError(`items[${patch._id}].times phải có đúng ${existing.frequency} mục`, 400);
    }
  }

  const changeLog = [];
  const rescheduleItems = [];
  for (const patch of items) {
    const existing = prescription.items.id(patch._id);
    if (patch.times !== undefined) {
      const timesChanged =
        JSON.stringify(existing.times.slice().sort()) !==
        JSON.stringify(patch.times.slice().sort());
      if (timesChanged) {
        existing.times = patch.times;
        changeLog.push(`Rescheduled ${existing.medicationName} times to [${patch.times.join(', ')}]`);
        rescheduleItems.push(existing);
      }
    }
    if (patch.instructions !== undefined && patch.instructions !== existing.instructions) {
      changeLog.push(`Updated ${existing.medicationName} instructions: "${patch.instructions}"`);
      existing.instructions = patch.instructions;
    }
  }

  if (!changeLog.length) {
    return { blocked: false, noChanges: true, data: prescription, warnings: [] };
  }

  prescription.editHistory.push({ editedBy: user._id, editedAt: new Date(), changes: changeLog.join('; ') });
  await prescriptionRepo.saveDoc(prescription);

  for (const item of rescheduleItems) {
    await generateSchedulesForItem(prescription, item);
  }

  const populated = await prescriptionRepo.findByIdListPopulated(prescription._id);
  return { blocked: false, data: populated, warnings: [] };
};

// ── Doctor item processing (create/update/soft-delete) ───────────────────────

const _processDoctorItems = async ({ prescription, items, acknowledgeWarnings, changeLog, user }) => {
  const softDeletePatches = [];
  const lightweightPatches = [];
  const activeEntries = [];

  for (const entry of items) {
    let existing = null;
    if (entry._id) {
      existing = prescription.items.id(entry._id);
      if (!existing) {
        throw new ServiceError(`Không tìm thấy _id ${entry._id} trong đơn thuốc này`, 400);
      }
    }
    if (entry.isActive === false) {
      if (!existing) {
        throw new ServiceError('Xóa mềm một item yêu cầu phải có _id', 400);
      }
      softDeletePatches.push(existing);
      continue;
    }
    if (!entry.medicationId) {
      if (!existing) {
        throw new ServiceError('Mỗi item phải bao gồm medicationId từ cơ sở dữ liệu dược phẩm (trừ khi xóa mềm với isActive:false)', 400);
      }
      lightweightPatches.push({ existing, entry });
      continue;
    }
    activeEntries.push(entry);
  }

  let medMap = new Map();
  if (activeEntries.length) {
    medMap = await resolveMedicationsFromDB(activeEntries);
  }

  const drugNames = activeEntries.map((i) => medMap.get(String(i.medicationId)).name);

  if (drugNames.length) {
    const { allergies: allergyHits } = await checkAllergies(prescription.residentId, drugNames);
    if (allergyHits.length) {
      return {
        blocked: true,
        statusCode: 400,
        payload: {
          success: false,
          errorCode: 'ALLERGY',
          detail: allergyHits,
          requiresAcknowledgment: false,
        },
      };
    }
  }

  const dosageItems = activeEntries.map((i) => ({
    medicationName: medMap.get(String(i.medicationId)).name,
    dosage: Number(i.dosage),
    frequency: Number(i.frequency),
    unit: medMap.get(String(i.medicationId)).unit,
  }));

  let contraWarnings = [];
  let interactionWarnings = [];
  let dosageWarnings = [];
  if (drugNames.length) {
    const [contraResult, interactResult, dosageResult] = await Promise.all([
      checkContraindications(prescription.residentId, drugNames),
      checkDrugInteractions(prescription.residentId, drugNames, prescription._id),
      checkElderlyDosage(prescription.residentId, dosageItems),
    ]);
    contraWarnings = contraResult.violations;
    interactionWarnings = interactResult.interactions;
    dosageWarnings = dosageResult.warnings;
  }

  const allWarnings = [
    ...contraWarnings.map((w) => ({ type: 'CONTRAINDICATION', ...w })),
    ...interactionWarnings.map((w) => ({ type: 'DRUG_INTERACTION', ...w })),
    ...dosageWarnings.map((w) => ({ type: 'ELDERLY_DOSAGE', ...w })),
  ];

  if (hasSevereWarning(contraWarnings, interactionWarnings, dosageWarnings) && !acknowledgeWarnings) {
    return {
      blocked: true,
      statusCode: 400,
      payload: {
        success: false,
        errorCode: 'REQUIRES_ACKNOWLEDGMENT',
        warnings: allWarnings,
        requiresAcknowledgment: true,
      },
    };
  }

  if (acknowledgeWarnings && allWarnings.length) {
    const uniqueTypes = [...new Set(allWarnings.map((w) => w.type))];
    for (const warningType of uniqueTypes) {
      prescription.acknowledgments.push({
        warningType,
        acknowledgedBy: user._id,
        acknowledgedAt: new Date(),
      });
    }
  }

  await medicationScheduleRepo.deleteManyByFilter({
    prescriptionId: prescription._id,
    status: 'PENDING',
    scheduledTime: { $gt: new Date() },
  });

  const overdosedDrugs = new Set(dosageWarnings.map((w) => w.medicationName));

  for (const existing of softDeletePatches) {
    if (existing.isActive) {
      changeLog.push(`Discontinued ${existing.medicationName}`);
    }
    existing.isActive = false;
  }

  if (softDeletePatches.length) {
    await medicationScheduleRepo.deleteManyByFilter({
      prescriptionId: prescription._id,
      prescriptionItemId: { $in: softDeletePatches.map((item) => item._id) },
      status: 'PENDING',
    });
  }

  for (const { existing, entry } of lightweightPatches) {
    if (entry.times !== undefined) {
      const timesChanged =
        JSON.stringify((existing.times || []).slice().sort()) !==
        JSON.stringify(entry.times.slice().sort());
      if (timesChanged) {
        existing.times = entry.times;
        changeLog.push(`Rescheduled ${existing.medicationName} times to [${entry.times.join(', ')}]`);
      }
    }
    if (entry.instructions !== undefined && entry.instructions !== existing.instructions) {
      changeLog.push(`Updated ${existing.medicationName} instructions: "${entry.instructions}"`);
      existing.instructions = entry.instructions;
    }
  }

  for (const entry of activeEntries) {
    const med = medMap.get(String(entry.medicationId));
    const quantity = Number(entry.quantity) || 1;
    const price = Number(entry.price) || 0;
    const taxRate = Number(entry.taxRate) || 0.05;
    const subtotalExclTax = Number(entry.subtotalExclTax) || (price * quantity);
    const taxAmount = Number(entry.taxAmount) || (subtotalExclTax * taxRate);
    const subtotalInclTax = Number(entry.subtotalInclTax) || (subtotalExclTax + taxAmount);

    const built = {
      medicationId: med._id,
      medicationName: med.name,
      genericName: entry.genericName || med.genericName || null,
      dosage: String(entry.dosage),
      unit: med.unit || null,
      quantity,
      price,
      taxRate,
      subtotalExclTax: Math.round(subtotalExclTax * 100) / 100,
      taxAmount: Math.round(taxAmount * 100) / 100,
      subtotalInclTax: Math.round(subtotalInclTax * 100) / 100,
      frequency: Number(entry.frequency),
      times: Array.isArray(entry.times) ? entry.times : [],
      route: entry.route || 'oral',
      duration: entry.duration,
      startDate: entry.startDate ? new Date(entry.startDate) : undefined,
      endDate: entry.endDate ? new Date(entry.endDate) : undefined,
      instructions: entry.instructions,
      elderlyDosageAdjusted: overdosedDrugs.has(med.name),
      isActive: true,
    };

    if (entry._id) {
      const existing = prescription.items.id(entry._id);
      Object.assign(existing, built);
      changeLog.push(`Updated ${med.name}`);
    } else {
      prescription.items.push(built);
      changeLog.push(`Added ${med.name}`);
    }
  }

  return { blocked: false, allWarnings };
};

// ── listPrescriptions ────────────────────────────────────────────────────────

const listPrescriptions = async ({ query, user }) => {
  const { residentId, status, page = 1, limit = 10 } = query;
  const scope = await getResidentScope(user._id, user.role);

  const filter = {};
  if (residentId) {
    if (!isValidObjectId(residentId)) {
      throw new ServiceError('residentId không hợp lệ', 400);
    }
    if (!isInScope(residentId, scope)) {
      throw new ServiceError('Cư dân không được phân công cho bạn', 403);
    }
    filter.residentId = residentId;
  } else if (scope !== null) {
    if (!scope.length) {
      return {
        data: [],
        pagination: { total: 0, page: Number(page), limit: Number(limit), totalPages: 0 },
      };
    }
    filter.residentId = { $in: scope };
  }

  if (status && status.toUpperCase() !== 'ALL') filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);

  const [prescriptions, total] = await Promise.all([
    prescriptionRepo.findAll(filter, { sort: { prescriptionDate: -1 }, skip, limit: Number(limit) }),
    prescriptionRepo.countAll(filter),
  ]);

  const invoiceRepo = require('../repositories/invoiceRepository');
  const prescriptionIds = prescriptions.map((rx) => rx._id);
  const allInvoices = await invoiceRepo.findByFilterLean(
    { prescriptionId: { $in: prescriptionIds } },
    { select: 'prescriptionId status', limit: 0 }
  );
  const invoicesByPrescription = {};
  for (const inv of allInvoices) {
    const key = inv.prescriptionId.toString();
    if (!invoicesByPrescription[key]) invoicesByPrescription[key] = [];
    invoicesByPrescription[key].push(inv);
  }

  const data = prescriptions.map((rx) => {
    const invoices = invoicesByPrescription[rx._id.toString()] || [];
    let invoiceStatus = 'no_invoice';
    let paymentStatus = null;
    if (invoices.length > 0) {
      const latestInvoice = invoices[0];
      const st = (latestInvoice.status || 'unpaid').toLowerCase();
      paymentStatus = st === 'paid' ? 'paid' :
                     st === 'partially_paid' ? 'partially_paid' : 'unpaid';
      invoiceStatus = paymentStatus;
    }

    return {
      ...rx.toObject(),
      itemsCount: rx.items.length,
      activeItemsCount: rx.items.filter((i) => i.isActive).length,
      invoiceStatus,
      paymentStatus,
    };
  });

  return {
    data,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    },
  };
};

// ── getPrescription ──────────────────────────────────────────────────────────

const getPrescription = async ({ id, user }) => {
  if (!isValidObjectId(id)) {
    throw new ServiceError('ID đơn thuốc không hợp lệ', 400);
  }

  const prescription = await prescriptionRepo.findByIdPopulated(id);
  if (!prescription) {
    throw new ServiceError('Không tìm thấy đơn thuốc', 404);
  }

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(prescription.residentId._id || prescription.residentId, scope)) {
    throw new ServiceError('Cư dân không được phân công cho bạn', 403);
  }

  const [takenCount, lateTakenCount, missedCount] = await Promise.all([
    medicationScheduleRepo.countByFilter({ prescriptionId: prescription._id, status: 'TAKEN' }),
    medicationScheduleRepo.countByFilter({ prescriptionId: prescription._id, status: 'LATE_TAKEN' }),
    medicationScheduleRepo.countByFilter({ prescriptionId: prescription._id, status: 'MISSED' }),
  ]);

  const denominator = takenCount + lateTakenCount + missedCount;
  const complianceRate = denominator > 0 ? Math.round(((takenCount + lateTakenCount) / denominator) * 1000) / 10 : null;

  return {
    ...prescription.toObject(),
    itemsCount: prescription.items.length,
    activeItemsCount: prescription.items.filter((i) => i.isActive).length,
    complianceRate,
  };
};

// ── estimatePrescriptionCost ─────────────────────────────────────────────────

const estimatePrescriptionCost = async ({ id, residentId, user }) => {
  if (!isValidObjectId(id)) {
    throw new ServiceError('ID đơn thuốc không hợp lệ', 400);
  }
  if (!residentId || !isValidObjectId(residentId)) {
    throw new ServiceError('residentId là tham số bắt buộc trong query', 400);
  }

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(residentId, scope)) {
    throw new ServiceError('Cư dân không được phân công cho bạn', 403);
  }

  const paymentService = require('./paymentService');
  const medicationCost = await paymentService.estimateMedicationCostForPrescription(id, residentId);
  return { medicationCost };
};

// ── activatePrescription ─────────────────────────────────────────────────────

const activatePrescription = async ({ id, user, req }) => {
  if (!isValidObjectId(id)) {
    throw new ServiceError('ID đơn thuốc không hợp lệ', 400);
  }

  const prescription = await prescriptionRepo.findById(id);
  if (!prescription) {
    throw new ServiceError('Không tìm thấy đơn thuốc', 404);
  }
  if (prescription.status !== 'DRAFT') {
    throw new ServiceError('Chỉ có thể kích hoạt đơn thuốc ở trạng thái DRAFT', 400);
  }

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(prescription.residentId, scope)) {
    throw new ServiceError('Cư dân không được phân công cho bạn', 403);
  }

  const prevStatus = prescription.status;
  prescription.status = 'ACTIVE';
  prescription.activatedAt = new Date();
  prescription.activatedBy = user._id;
  prescription.editHistory.push({
    editedBy: user._id,
    editedAt: new Date(),
    changes: 'Activated prescription from DRAFT',
    action: 'ACTIVATE',
  });
  await prescriptionRepo.saveDoc(prescription);
  await generateSchedules(prescription);

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'ACTIVATE_PRESCRIPTION',
    module: 'prescription',
    targetEntityType: 'Prescription',
    targetEntityId: prescription._id,
    beforeData: { status: prevStatus },
    afterData: { status: 'ACTIVE' },
    description: 'Kích hoạt đơn thuốc từ trạng thái DRAFT',
    req,
  });

  return prescription;
};

// ── suspendPrescription ──────────────────────────────────────────────────────

const suspendPrescription = async ({ id, reason, user, req }) => {
  if (!isValidObjectId(id)) {
    throw new ServiceError('ID đơn thuốc không hợp lệ', 400);
  }

  if (!reason || reason.trim().length < 5) {
    throw new ServiceError('Lý do tạm ngưng phải có ít nhất 5 ký tự', 400);
  }

  const prescription = await prescriptionRepo.findById(id);
  if (!prescription) {
    throw new ServiceError('Không tìm thấy đơn thuốc', 404);
  }
  if (prescription.status !== 'ACTIVE') {
    throw new ServiceError('Chỉ có thể tạm ngưng đơn thuốc đang hoạt động (ACTIVE)', 400);
  }

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(prescription.residentId, scope)) {
    throw new ServiceError('Cư dân không được phân công cho bạn', 403);
  }

  // Load resident for audit log detail
  const resident = await residentRepo.findById(prescription.residentId);
  const residentFullName = resident
    ? (resident.fullName || resident.profile?.fullName || resident.profile?.fullname || String(prescription.residentId))
    : String(prescription.residentId);
  const medicationSummary = prescription.items
    .map((item) => `${item.medicationName} (${item.dosage}${item.unit ? ' ' + item.unit : ''})`)
    .join(', ');

  prescription.status = 'SUSPENDED';
  prescription.suspendedAt = new Date();
  prescription.suspendedBy = user._id;
  prescription.suspendedReason = reason.trim();
  prescription.editHistory.push({
    editedBy: user._id,
    editedAt: new Date(),
    changes: `Suspended: ${reason.trim()}`,
    action: 'SUSPEND',
  });
  await prescriptionRepo.saveDoc(prescription);

  await medicationScheduleRepo.updateManyByFilter(
    { prescriptionId: prescription._id, status: { $in: ['PENDING', 'OVERDUE'] } },
    { $set: { status: 'HELD' } }
  );

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'SUSPEND_PRESCRIPTION',
    module: 'prescription',
    targetEntityType: 'Prescription',
    targetEntityId: prescription._id,
    targetName: `Tạm ngưng đơn thuốc cho ${residentFullName} - ${medicationSummary}`,
    afterData: {
      status: 'SUSPENDED',
      reason: reason.trim(),
      residentId: String(prescription.residentId),
      residentName: residentFullName,
      items: prescription.items.map((item) => ({
        medicationName: item.medicationName,
        dosage: item.dosage,
        unit: item.unit,
      })),
    },
    description: `Tạm ngưng đơn thuốc cho cư dân "${residentFullName}" - Lý do: ${reason.trim()}`,
    req,
  });

  return prescription;
};

// ── resumePrescription ───────────────────────────────────────────────────────

const resumePrescription = async ({ id, user, req }) => {
  if (!isValidObjectId(id)) {
    throw new ServiceError('ID đơn thuốc không hợp lệ', 400);
  }

  const prescription = await prescriptionRepo.findById(id);
  if (!prescription) {
    throw new ServiceError('Không tìm thấy đơn thuốc', 404);
  }
  if (prescription.status !== 'SUSPENDED') {
    throw new ServiceError('Chỉ có thể tiếp tục đơn thuốc đang tạm ngưng (SUSPENDED)', 400);
  }

  if (prescription.validUntil <= new Date()) {
    throw new ServiceError('Đơn thuốc đã hết hạn, không thể tiếp tục', 400);
  }

  const scope = await getResidentScope(user._id, user.role);
  if (!isInScope(prescription.residentId, scope)) {
    throw new ServiceError('Cư dân không được phân công cho bạn', 403);
  }

  // Load resident for audit log detail
  const resident = await residentRepo.findById(prescription.residentId);
  const residentFullName = resident
    ? (resident.fullName || resident.profile?.fullName || resident.profile?.fullname || String(prescription.residentId))
    : String(prescription.residentId);
  const medicationSummary = prescription.items
    .map((item) => `${item.medicationName} (${item.dosage}${item.unit ? ' ' + item.unit : ''})`)
    .join(', ');

  prescription.status = 'ACTIVE';
  prescription.suspendedAt = undefined;
  prescription.suspendedBy = undefined;
  prescription.suspendedReason = undefined;
  prescription.editHistory.push({
    editedBy: user._id,
    editedAt: new Date(),
    changes: 'Resumed prescription from SUSPENDED',
    action: 'RESUME',
  });
  await prescriptionRepo.saveDoc(prescription);

  await medicationScheduleRepo.updateManyByFilter(
    { prescriptionId: prescription._id, status: 'HELD', scheduledTime: { $gt: new Date() } },
    { $set: { status: 'PENDING' } }
  );

  await generateSchedules(prescription);

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'RESUME_PRESCRIPTION',
    module: 'prescription',
    targetEntityType: 'Prescription',
    targetEntityId: prescription._id,
    targetName: `Tiếp tục đơn thuốc cho ${residentFullName} - ${medicationSummary}`,
    afterData: {
      status: 'ACTIVE',
      residentId: String(prescription.residentId),
      residentName: residentFullName,
      items: prescription.items.map((item) => ({
        medicationName: item.medicationName,
        dosage: item.dosage,
        unit: item.unit,
      })),
    },
    description: `Tiếp tục đơn thuốc cho cư dân "${residentFullName}"`,
    req,
  });

  return prescription;
};

module.exports = {
  createPrescription,
  editPrescription,
  listPrescriptions,
  getPrescription,
  estimatePrescriptionCost,
  activatePrescription,
  suspendPrescription,
  resumePrescription,
};

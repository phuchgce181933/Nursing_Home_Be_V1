const { isValidObjectId } = require('mongoose');
const Prescription = require('../models/prescription');
const Resident = require('../models/resident');
const Medication = require('../models/medication');
const StaffProfile = require('../models/staffProfile');
const MedicationSchedule = require('../models/MedicationSchedule');
const paymentService = require('../services/paymentService');
const {
  checkAllergies,
  checkContraindications,
  checkDrugInteractions,
  checkElderlyDosage,
} = require('../services/medicationSafetyService');
const {
  generateSchedules,
  generateSchedulesForItem,
} = require('../services/scheduleGeneratorService');

const ACK_REQUIRED_INTERACTION = new Set(['SEVERE']);
const ACK_REQUIRED_CONTRAINDICATION = new Set(['HIGH', 'CRITICAL']);

// ── Scope helpers ─────────────────────────────────────────────────────────────

// Returns null (unrestricted) for admin/manager, or array of resident ID strings for doctor/nurse
const getResidentScope = async (userId, role) => {
  if (['admin'].includes(role)) return null;
  const profile = await StaffProfile.findOne({ userId }).select('assignedResidentIds');
  if (!profile) return [];
  return profile.assignedResidentIds.map(String);
};

const isInScope = (residentId, scope) =>
  scope === null || scope.includes(String(residentId));

// ── Medication DB helpers ─────────────────────────────────────────────────────

// Validates that every medicationId in items[] exists and is active in the pharmacy DB.
// Returns a Map<id_string → Medication doc> on success, throws on any missing.
const resolveMedicationsFromDB = async (items) => {
  const allIds = items.map((i) => String(i.medicationId));
  const seen = new Set();
  const duplicates = new Set();
  for (const id of allIds) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size) {
    throw Object.assign(
      new Error(`Duplicate medication(s) in items: a medication can only appear once per prescription (medicationId: ${[...duplicates].join(', ')})`),
      { statusCode: 400 }
    );
  }

  const ids = [...seen];
  const meds = await Medication.find({ _id: { $in: ids }, isActive: true })
    .select('_id name genericName form strength unit');
  if (meds.length !== ids.length) {
    const foundIds = new Set(meds.map((m) => m._id.toString()));
    const missing = ids.filter((id) => !foundIds.has(id));
    throw Object.assign(
      new Error(`Medication(s) not found in pharmacy database or inactive: ${missing.join(', ')}`),
      { statusCode: 400 }
    );
  }
  return new Map(meds.map((m) => [m._id.toString(), m]));
};

const ACK_REQUIRED_DOSAGE = new Set(['HIGH', 'CRITICAL']);

const hasSevereWarning = (contraWarnings, interactionWarnings, dosageWarnings = []) =>
  interactionWarnings.some((w) => ACK_REQUIRED_INTERACTION.has(w.severity)) ||
  contraWarnings.some((w) => ACK_REQUIRED_CONTRAINDICATION.has(w.severity)) ||
  dosageWarnings.some((w) => ACK_REQUIRED_DOSAGE.has(w.severity));

// ── POST /api/prescriptions ───────────────────────────────────────────────────

const createPrescription = async (req, res) => {
  try {
    const { residentId, diagnosisNote, validUntil, items, acknowledgeWarnings } = req.body;

    // 1. Scope check — doctor can only prescribe for their assigned residents
    const scope = await getResidentScope(req.user._id, req.user.role);
    if (!isInScope(residentId, scope)) {
      return res.status(403).json({ success: false, message: 'Resident is not assigned to you' });
    }

    // 2. Resident exists
    const resident = await Resident.findById(residentId).select('_id residencyStatus');
    if (!resident) {
      return res.status(404).json({ success: false, message: 'Resident not found' });
    }
    if (resident.residencyStatus !== 'admitted') {
      return res.status(400).json({ success: false, message: 'Resident is not currently admitted' });
    }

    // 3. Resolve medications from pharmacy DB — prevents free-text drug names
    let medMap;
    try {
      medMap = await resolveMedicationsFromDB(items);
    } catch (e) {
      return res.status(e.statusCode || 400).json({ success: false, message: e.message });
    }

    // 4. Build drug name list from pharmacy records (not user input)
    const drugNames = items.map((i) => medMap.get(String(i.medicationId)).name);

    // 5. Allergy check — hard block
    const { allergies: allergyHits } = await checkAllergies(residentId, drugNames);
    if (allergyHits.length) {
      return res.status(400).json({
        success: false,
        errorCode: 'ALLERGY',
        detail: allergyHits,
        requiresAcknowledgment: false,
      });
    }

    // 6. Safety checks
    const dosageItems = items.map((i) => ({
      medicationName: medMap.get(String(i.medicationId)).name,
      dosage: Number(i.dosage),
      frequency: Number(i.frequency),
      unit: medMap.get(String(i.medicationId)).unit,
    }));

    const [contraResult, interactResult, dosageResult] = await Promise.all([
      checkContraindications(residentId, drugNames),
      checkDrugInteractions(residentId, drugNames),
      checkElderlyDosage(residentId, dosageItems),
    ]);

    const contraWarnings = contraResult.violations;
    const interactionWarnings = interactResult.interactions;
    const dosageWarnings = dosageResult.warnings;

    const allWarnings = [
      ...contraWarnings.map((w) => ({ type: 'CONTRAINDICATION', ...w })),
      ...interactionWarnings.map((w) => ({ type: 'DRUG_INTERACTION', ...w })),
      ...dosageWarnings.map((w) => ({ type: 'ELDERLY_DOSAGE', ...w })),
    ];

    if (hasSevereWarning(contraWarnings, interactionWarnings, dosageWarnings) && !acknowledgeWarnings) {
      return res.status(400).json({
        success: false,
        errorCode: 'REQUIRES_ACKNOWLEDGMENT',
        warnings: allWarnings,
        requiresAcknowledgment: true,
      });
    }

    const acknowledgments = [];
    if (acknowledgeWarnings && allWarnings.length) {
      const uniqueTypes = [...new Set(allWarnings.map((w) => w.type))];
      for (const warningType of uniqueTypes) {
        acknowledgments.push({
          warningType,
          acknowledgedBy: req.user._id,
          acknowledgedAt: new Date(),
        });
      }
    }

    const overdosedDrugs = new Set(dosageWarnings.map((w) => w.medicationName));

    // 7. Build prescription items — medicationName comes from pharmacy DB, not user input
    const prescription = await Prescription.create({
      residentId,
      doctorId: req.user._id,
      diagnosisNote,
      prescriptionDate: new Date(),
      validUntil: new Date(validUntil),
      status: 'ACTIVE',
      items: items.map((item) => {
        const med = medMap.get(String(item.medicationId));
        return {
          medicationId: med._id,
          medicationName: med.name,
          genericName: item.genericName || med.genericName || null,
          dosage: String(item.dosage),
          unit: med.unit || null,
          frequency: Number(item.frequency),
          times: Array.isArray(item.times) ? item.times : [],
          route: item.route || 'oral',
          duration: item.duration,
          startDate: item.startDate ? new Date(item.startDate) : undefined,
          endDate: item.endDate ? new Date(item.endDate) : undefined,
          instructions: item.instructions,
          elderlyDosageAdjusted: overdosedDrugs.has(med.name),
          isActive: true,
        };
      }),
      acknowledgments,
    });

    // 8. Auto-generate medication schedules for items that have startDate + endDate + times
    await generateSchedules(prescription);

    return res.status(201).json({
      success: true,
      data: prescription,
      warnings: allWarnings,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/prescriptions/:id ────────────────────────────────────────────────

const editPrescription = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid prescription id' });
    }

    const role = req.user.role;
    const { diagnosisNote, validUntil, items, acknowledgeWarnings, status } = req.body;

    const prescription = await Prescription.findById(id);
    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }
    if (prescription.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, message: 'Only ACTIVE prescriptions can be edited' });
    }

    // Scope check
    const scope = await getResidentScope(req.user._id, role);
    if (!isInScope(prescription.residentId, scope)) {
      return res.status(403).json({ success: false, message: 'Resident is not assigned to you' });
    }

    const changeLog = [];
    let allWarnings = [];

    if (role === 'nurse') {
      // ── Nurse: only times and instructions per item (matched by _id) ──────
      if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({
          success: false,
          message: 'Nurse edits require items[] with item _id references',
        });
      }

      // Validate ALL patches before modifying anything
      for (const patch of items) {
        const existing = prescription.items.id(patch._id);
        if (!existing) {
          return res.status(400).json({
            success: false,
            message: `Item _id ${patch._id} not found in this prescription`,
          });
        }
        if (
          patch.times !== undefined &&
          (!Array.isArray(patch.times) || !patch.times.length || patch.times.length !== existing.frequency)
        ) {
          return res.status(400).json({
            success: false,
            message: `items[${patch._id}].times must have exactly ${existing.frequency} entries`,
          });
        }
      }

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
        return res.status(200).json({ success: true, message: 'No changes detected', data: prescription, warnings: [] });
      }

      prescription.editHistory.push({ editedBy: req.user._id, editedAt: new Date(), changes: changeLog.join('; ') });
      await prescription.save();

      for (const item of rescheduleItems) {
        await generateSchedulesForItem(prescription, item);
      }

      const populatedNurse = await Prescription.findById(prescription._id)
        .populate('residentId', 'fullName dateOfBirth')
        .populate('doctorId', 'fullName')
        .populate('items.medicationId', 'name medicationCode form strength unit')
        .populate('editHistory.editedBy', 'fullName role');

      return res.status(200).json({ success: true, data: populatedNurse, warnings: [] });
    }

    // ── Doctor: full edit — diagnosisNote, validUntil, items[] ────────────────
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
        return res.status(400).json({
          success: false,
          message: `status must be one of: ${ALLOWED_STATUSES.join(', ')}`,
        });
      }
      changeLog.push(`Changed status from ${prescription.status} to ${status}`);
      prescription.status = status;
    }

    if (Array.isArray(items) && items.length) {
      // Split the request into soft-delete patches ({_id, isActive:false} — discontinue
      // an existing item without erasing it), lightweight patches (only _id + times/
      // instructions on an existing item — no medication change), and active entries
      // (new or full replacement of an existing item, which must reference a pharmacy
      // medicationId).
      const softDeletePatches = [];
      const lightweightPatches = [];
      const activeEntries = [];

      for (const entry of items) {
        let existing = null;
        if (entry._id) {
          existing = prescription.items.id(entry._id);
          if (!existing) {
            return res.status(400).json({
              success: false,
              message: `Item _id ${entry._id} not found in this prescription`,
            });
          }
        }
        if (entry.isActive === false) {
          if (!existing) {
            return res.status(400).json({
              success: false,
              message: 'Soft-deleting an item requires its _id',
            });
          }
          softDeletePatches.push(existing);
          continue;
        }
        if (!entry.medicationId) {
          if (!existing) {
            return res.status(400).json({
              success: false,
              message: 'Each item must include medicationId from the pharmacy database (unless soft-deleting with isActive:false)',
            });
          }
          // No medicationId + an existing _id: treat as a lightweight patch
          // (times/instructions only) rather than a full medication replacement.
          lightweightPatches.push({ existing, entry });
          continue;
        }
        activeEntries.push(entry);
      }

      let medMap = new Map();
      if (activeEntries.length) {
        try {
          medMap = await resolveMedicationsFromDB(activeEntries);
        } catch (e) {
          return res.status(e.statusCode || 400).json({ success: false, message: e.message });
        }
      }

      const drugNames = activeEntries.map((i) => medMap.get(String(i.medicationId)).name);

      // Allergy hard block
      if (drugNames.length) {
        const { allergies: allergyHits } = await checkAllergies(prescription.residentId, drugNames);
        if (allergyHits.length) {
          return res.status(400).json({
            success: false,
            errorCode: 'ALLERGY',
            detail: allergyHits,
            requiresAcknowledgment: false,
          });
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

      allWarnings = [
        ...contraWarnings.map((w) => ({ type: 'CONTRAINDICATION', ...w })),
        ...interactionWarnings.map((w) => ({ type: 'DRUG_INTERACTION', ...w })),
        ...dosageWarnings.map((w) => ({ type: 'ELDERLY_DOSAGE', ...w })),
      ];

      if (hasSevereWarning(contraWarnings, interactionWarnings, dosageWarnings) && !acknowledgeWarnings) {
        return res.status(400).json({
          success: false,
          errorCode: 'REQUIRES_ACKNOWLEDGMENT',
          warnings: allWarnings,
          requiresAcknowledgment: true,
        });
      }

      if (acknowledgeWarnings && allWarnings.length) {
        const uniqueTypes = [...new Set(allWarnings.map((w) => w.type))];
        for (const warningType of uniqueTypes) {
          prescription.acknowledgments.push({
            warningType,
            acknowledgedBy: req.user._id,
            acknowledgedAt: new Date(),
          });
        }
      }

      // Drop all future pending schedules — regenerated below from the merged items[]
      await MedicationSchedule.deleteMany({
        prescriptionId: prescription._id,
        status: 'PENDING',
        scheduledTime: { $gt: new Date() },
      });

      const overdosedDrugs = new Set(dosageWarnings.map((w) => w.medicationName));

      // Soft-delete: keep the item (audit trail intact), just mark it inactive.
      for (const existing of softDeletePatches) {
        if (existing.isActive) {
          changeLog.push(`Discontinued ${existing.medicationName}`);
        }
        existing.isActive = false;
      }

      // Lightweight patches: only times/instructions change, no medication/dosage change.
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

      // Active entries: update the matching existing item in place, or append a new one.
      // Items not mentioned in the request are left untouched (no more hard-delete by omission).
      for (const entry of activeEntries) {
        const med = medMap.get(String(entry.medicationId));
        const built = {
          medicationId: med._id,
          medicationName: med.name,
          genericName: entry.genericName || med.genericName || null,
          dosage: String(entry.dosage),
          unit: med.unit || null,
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
    }

    if (!changeLog.length) {
      return res.status(200).json({ success: true, message: 'No changes detected', data: prescription, warnings: allWarnings });
    }

    prescription.editHistory.push({
      editedBy: req.user._id,
      editedAt: new Date(),
      changes: changeLog.join('; '),
    });

    await prescription.save();

    if (Array.isArray(items) && items.length) {
      await generateSchedules(prescription);
    }

    const populated = await Prescription.findById(prescription._id)
      .populate('residentId', 'fullName dateOfBirth')
      .populate('doctorId', 'fullName')
      .populate('items.medicationId', 'name medicationCode form strength unit')
      .populate('editHistory.editedBy', 'fullName role');

    return res.status(200).json({ success: true, data: populated, warnings: allWarnings });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── GET /api/prescriptions ────────────────────────────────────────────────────

const listPrescriptions = async (req, res) => {
  try {
    const { residentId, status, page = 1, limit = 10 } = req.query;

    const scope = await getResidentScope(req.user._id, req.user.role);

    const filter = {};
    if (residentId) {
      if (!isValidObjectId(residentId)) {
        return res.status(400).json({ success: false, message: 'Invalid residentId' });
      }
      if (!isInScope(residentId, scope)) {
        return res.status(403).json({ success: false, message: 'Resident is not assigned to you' });
      }
      filter.residentId = residentId;
    } else if (scope !== null) {
      // No residentId given — doctor/nurse: list across all their assigned residents.
      if (!scope.length) {
        return res.status(200).json({
          success: true,
          data: [],
          pagination: { total: 0, page: Number(page), limit: Number(limit), totalPages: 0 },
        });
      }
      filter.residentId = { $in: scope };
    }
    // else: admin (scope === null) with no residentId — list across all residents

    if (status && status.toUpperCase() !== 'ALL') filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);

    const [prescriptions, total] = await Promise.all([
      Prescription.find(filter)
        .populate('residentId', 'fullName dateOfBirth')
        .populate('doctorId', 'fullName')
        .populate('items.medicationId', 'name medicationCode form strength unit')
        .sort({ prescriptionDate: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Prescription.countDocuments(filter),
    ]);

    const Invoice = require('../models/invoice');
    const prescriptionIds = prescriptions.map((rx) => rx._id);
    const allInvoices = await Invoice.find({ prescriptionId: { $in: prescriptionIds } }).select('prescriptionId status');
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
        // Normalize invoice status to lowercase for frontend
        const status = (latestInvoice.status || 'unpaid').toLowerCase();
        paymentStatus = status === 'paid' ? 'paid' : 
                       status === 'partially_paid' ? 'partially_paid' : 'unpaid';
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

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── GET /api/prescriptions/:id ────────────────────────────────────────────────

const getPrescription = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid prescription id' });
    }

    const prescription = await Prescription.findById(req.params.id)
      .populate('residentId', 'fullName dateOfBirth chronicConditions allergies')
      .populate('doctorId', 'fullName')
      .populate('items.medicationId', 'name medicationCode form strength unit description')
      .populate('acknowledgments.acknowledgedBy', 'fullName role')
      .populate('editHistory.editedBy', 'fullName role');

    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    // Scope check
    const scope = await getResidentScope(req.user._id, req.user.role);
    if (!isInScope(prescription.residentId._id || prescription.residentId, scope)) {
      return res.status(403).json({ success: false, message: 'Resident is not assigned to you' });
    }

    const [takenCount, lateTakenCount, missedCount] = await Promise.all([
      MedicationSchedule.countDocuments({ prescriptionId: prescription._id, status: 'TAKEN' }),
      MedicationSchedule.countDocuments({ prescriptionId: prescription._id, status: 'LATE_TAKEN' }),
      MedicationSchedule.countDocuments({ prescriptionId: prescription._id, status: 'MISSED' }),
    ]);

    const denominator = takenCount + lateTakenCount + missedCount;
    const complianceRate = denominator > 0 ? Math.round(((takenCount + lateTakenCount) / denominator) * 1000) / 10 : null;

    return res.status(200).json({
      success: true,
      data: {
        ...prescription.toObject(),
        itemsCount: prescription.items.length,
        activeItemsCount: prescription.items.filter((i) => i.isActive).length,
        complianceRate,
      },
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

const estimatePrescriptionCost = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { residentId } = req.query;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid prescription id' });
    }
    if (!residentId || !isValidObjectId(residentId)) {
      return res.status(400).json({ success: false, message: 'residentId query parameter is required' });
    }

    const scope = await getResidentScope(req.user._id, req.user.role);
    if (!isInScope(residentId, scope)) {
      return res.status(403).json({ success: false, message: 'Resident is not assigned to you' });
    }

    const medicationCost = await paymentService.estimateMedicationCostForPrescription(id, residentId);
    return res.status(200).json({ success: true, data: { medicationCost } });
  } catch (err) {
    return next(err);
  }
};

module.exports = { createPrescription, editPrescription, listPrescriptions, getPrescription, estimatePrescriptionCost };

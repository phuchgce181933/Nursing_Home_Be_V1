const { isValidObjectId } = require('mongoose');
const Prescription = require('../models/prescription');
const Resident = require('../models/resident');
const MedicationSchedule = require('../models/MedicationSchedule');
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

const hasSevereWarning = (contraWarnings, interactionWarnings) =>
  interactionWarnings.some((w) => ACK_REQUIRED_INTERACTION.has(w.severity)) ||
  contraWarnings.some((w) => ACK_REQUIRED_CONTRAINDICATION.has(w.severity));

// ── POST /api/prescriptions ───────────────────────────────────────────────────

const createPrescription = async (req, res) => {
  try {
    const { residentId, diagnosisNote, validUntil, items, acknowledgeWarnings } = req.body;

    const resident = await Resident.findById(residentId).select('_id');
    if (!resident) {
      return res.status(404).json({ success: false, message: 'Resident not found' });
    }

    const drugNames = items.map((i) => i.medicationName);

    // Allergy check — hard block, no acknowledgment bypass
    const { allergies: allergyHits } = await checkAllergies(residentId, drugNames);
    if (allergyHits.length) {
      return res.status(400).json({
        success: false,
        errorCode: 'ALLERGY',
        detail: allergyHits,
        requiresAcknowledgment: false,
      });
    }

    const dosageItems = items.map((i) => ({
      medicationName: i.medicationName,
      dosage: Number(i.dosage),
      frequency: Number(i.frequency),
      unit: i.unit,
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

    if (hasSevereWarning(contraWarnings, interactionWarnings) && !acknowledgeWarnings) {
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

    const prescription = await Prescription.create({
      residentId,
      doctorId: req.user._id,
      diagnosisNote,
      prescriptionDate: new Date(),
      validUntil: new Date(validUntil),
      status: 'ACTIVE',
      items: items.map((item) => ({
        medicationName: item.medicationName,
        genericName: item.genericName,
        dosage: String(item.dosage),
        unit: item.unit,
        frequency: Number(item.frequency),
        times: Array.isArray(item.times) ? item.times : [],
        route: item.route || 'oral',
        duration: item.duration,
        startDate: item.startDate ? new Date(item.startDate) : undefined,
        endDate: item.endDate ? new Date(item.endDate) : undefined,
        instructions: item.instructions,
        elderlyDosageAdjusted: overdosedDrugs.has(item.medicationName),
        isActive: true,
      })),
      acknowledgments,
    });

    await generateSchedules(prescription);

    return res.status(201).json({
      success: true,
      data: prescription,
      warnings: allWarnings,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message,
    });
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
    const { diagnosisNote, validUntil, items, acknowledgeWarnings } = req.body;

    const prescription = await Prescription.findById(id);
    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }
    if (prescription.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: 'Only ACTIVE prescriptions can be edited',
      });
    }

    const changeLog = [];
    let allWarnings = [];

    if (role === 'nurse') {
      // Nurse: only instructions and times per item (matched by _id)
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
          (!Array.isArray(patch.times) || patch.times.length !== existing.frequency)
        ) {
          return res.status(400).json({
            success: false,
            message: `items[${patch._id}].times must have exactly ${existing.frequency} entries`,
          });
        }
      }

      // Apply changes in memory and collect items that need schedule regeneration
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

      // Regenerate schedules AFTER successful save
      for (const item of rescheduleItems) {
        await generateSchedulesForItem(prescription, item);
      }

      const populatedNurse = await Prescription.findById(prescription._id)
        .populate('residentId', 'fullName dateOfBirth')
        .populate('doctorId', 'fullName')
        .populate('editHistory.editedBy', 'fullName role');

      return res.status(200).json({ success: true, data: populatedNurse, warnings: [] });
    } else {
      // Doctor: full edit — diagnosisNote, validUntil, items[]
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

      if (Array.isArray(items) && items.length) {
        const drugNames = items.map((i) => i.medicationName);

        // Allergy hard block
        const { allergies: allergyHits } = await checkAllergies(
          prescription.residentId,
          drugNames
        );
        if (allergyHits.length) {
          return res.status(400).json({
            success: false,
            errorCode: 'ALLERGY',
            detail: allergyHits,
            requiresAcknowledgment: false,
          });
        }

        const dosageItems = items.map((i) => ({
          medicationName: i.medicationName,
          dosage: Number(i.dosage),
          frequency: Number(i.frequency),
          unit: i.unit,
        }));

        const [contraResult, interactResult, dosageResult] = await Promise.all([
          checkContraindications(prescription.residentId, drugNames),
          checkDrugInteractions(prescription.residentId, drugNames, prescription._id),
          checkElderlyDosage(prescription.residentId, dosageItems),
        ]);

        const contraWarnings = contraResult.violations;
        const interactionWarnings = interactResult.interactions;
        const dosageWarnings = dosageResult.warnings;

        allWarnings = [
          ...contraWarnings.map((w) => ({ type: 'CONTRAINDICATION', ...w })),
          ...interactionWarnings.map((w) => ({ type: 'DRUG_INTERACTION', ...w })),
          ...dosageWarnings.map((w) => ({ type: 'ELDERLY_DOSAGE', ...w })),
        ];

        if (hasSevereWarning(contraWarnings, interactionWarnings) && !acknowledgeWarnings) {
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

        // Delete all future PENDING schedules for this prescription before full item replacement
        await MedicationSchedule.deleteMany({
          prescriptionId: prescription._id,
          status: 'PENDING',
          scheduledTime: { $gt: new Date() },
        });

        const overdosedDrugs = new Set(dosageWarnings.map((w) => w.medicationName));

        prescription.items = items.map((item) => ({
          medicationName: item.medicationName,
          genericName: item.genericName,
          dosage: String(item.dosage),
          unit: item.unit,
          frequency: Number(item.frequency),
          times: Array.isArray(item.times) ? item.times : [],
          route: item.route || 'oral',
          duration: item.duration,
          startDate: item.startDate ? new Date(item.startDate) : undefined,
          endDate: item.endDate ? new Date(item.endDate) : undefined,
          instructions: item.instructions,
          elderlyDosageAdjusted: overdosedDrugs.has(item.medicationName),
          isActive: true,
        }));

        changeLog.push(`Replaced items (${items.length} medication(s))`);
      }
    }

    if (!changeLog.length) {
      return res.status(200).json({
        success: true,
        message: 'No changes detected',
        data: prescription,
        warnings: allWarnings,
      });
    }

    prescription.editHistory.push({
      editedBy: req.user._id,
      editedAt: new Date(),
      changes: changeLog.join('; '),
    });

    await prescription.save();

    // After save, new items have stable _ids — bulk-generate all schedules
    if (Array.isArray(items) && items.length) {
      await generateSchedules(prescription);
    }

    const populated = await Prescription.findById(prescription._id)
      .populate('residentId', 'fullName dateOfBirth')
      .populate('doctorId', 'fullName')
      .populate('editHistory.editedBy', 'fullName role');

    return res.status(200).json({
      success: true,
      data: populated,
      warnings: allWarnings,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message,
    });
  }
};

// ── GET /api/prescriptions ────────────────────────────────────────────────────

const listPrescriptions = async (req, res) => {
  try {
    const { residentId, status, page = 1, limit = 10 } = req.query;

    if (!residentId) {
      return res.status(400).json({
        success: false,
        message: 'residentId query parameter is required',
      });
    }

    if (!isValidObjectId(residentId)) {
      return res.status(400).json({ success: false, message: 'Invalid residentId' });
    }

    const filter = { residentId };
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);

    const [prescriptions, total] = await Promise.all([
      Prescription.find(filter)
        .populate('residentId', 'fullName dateOfBirth')
        .populate('doctorId', 'fullName')
        .sort({ prescriptionDate: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Prescription.countDocuments(filter),
    ]);

    const data = prescriptions.map((rx) => ({
      ...rx.toObject(),
      itemsCount: rx.items.length,
      activeItemsCount: rx.items.filter((i) => i.isActive).length,
    }));

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
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message,
    });
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
      .populate('acknowledgments.acknowledgedBy', 'fullName role')
      .populate('editHistory.editedBy', 'fullName role');

    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    // Compute compliance rate from MedicationSchedule
    const [takenCount, missedCount] = await Promise.all([
      MedicationSchedule.countDocuments({
        prescriptionId: prescription._id,
        status: { $in: ['TAKEN', 'LATE_TAKEN'] },
      }),
      MedicationSchedule.countDocuments({
        prescriptionId: prescription._id,
        status: 'MISSED',
      }),
    ]);

    const denominator = takenCount + missedCount;
    const complianceRate =
      denominator > 0 ? Math.round((takenCount / denominator) * 1000) / 10 : null;

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
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message,
    });
  }
};

module.exports = { createPrescription, editPrescription, listPrescriptions, getPrescription };

const Prescription = require('../models/prescription');
const Resident = require('../models/resident');
const {
  checkAllergies,
  checkContraindications,
  checkDrugInteractions,
  checkElderlyDosage,
} = require('../services/medicationSafetyService');

// Severity levels that require explicit acknowledgment before proceeding
const ACK_REQUIRED_INTERACTION = new Set(['SEVERE']);
const ACK_REQUIRED_CONTRAINDICATION = new Set(['HIGH', 'CRITICAL']);

const hasSevereWarning = (contraWarnings, interactionWarnings) =>
  interactionWarnings.some((w) => ACK_REQUIRED_INTERACTION.has(w.severity)) ||
  contraWarnings.some((w) => ACK_REQUIRED_CONTRAINDICATION.has(w.severity));

const createPrescription = async (req, res) => {
  try {
    const { residentId, diagnosisNote, validUntil, items, acknowledgeWarnings } = req.body;

    // Confirm resident exists (validator checks ObjectId format; this confirms it exists)
    const resident = await Resident.findById(residentId).select('_id');
    if (!resident) {
      return res.status(404).json({ success: false, message: 'Resident not found' });
    }

    const drugNames = items.map((i) => i.medicationName);

    // ── Step 1: Allergy check — hard block, no acknowledgment bypass ─────────
    const { allergies: allergyHits } = await checkAllergies(residentId, drugNames);
    if (allergyHits.length) {
      return res.status(400).json({
        success: false,
        errorCode: 'ALLERGY',
        detail: allergyHits,
        requiresAcknowledgment: false,
      });
    }

    // ── Steps 2–4: Safety checks that can be acknowledged ────────────────────
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

    // ── Step 3: Gate on severe warnings ──────────────────────────────────────
    if (hasSevereWarning(contraWarnings, interactionWarnings) && !acknowledgeWarnings) {
      return res.status(400).json({
        success: false,
        errorCode: 'REQUIRES_ACKNOWLEDGMENT',
        warnings: allWarnings,
        requiresAcknowledgment: true,
      });
    }

    // Build one acknowledgment record per warning type when doctor acknowledges
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

    // ── Step 4: Persist prescription ─────────────────────────────────────────
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

    // ── Step 5: Respond ───────────────────────────────────────────────────────
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

module.exports = { createPrescription };

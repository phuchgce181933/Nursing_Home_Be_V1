const Resident = require('../models/resident');
const Prescription = require('../models/prescription');
const ContraindicationRule = require('../models/ContraindicationRule');
const DrugInteraction = require('../models/DrugInteraction');
const ElderlyDosageGuideline = require('../models/ElderlyDosageGuideline');
const ServiceError = require('./serviceError');

const getResidentOrThrow = async (residentId) => {
  const resident = await Resident.findById(residentId).select('chronicConditions allergies dateOfBirth');
  if (!resident) throw new ServiceError('Resident not found', 404);
  return resident;
};

/**
 * Check if any of the given drugs are contraindicated by the resident's chronic conditions.
 * @returns {{ violations: Array<{ drug, condition, severity, description }> }}
 */
const checkContraindications = async (residentId, drugNames) => {
  const resident = await getResidentOrThrow(residentId);
  const { chronicConditions } = resident;

  if (!chronicConditions.length || !drugNames.length) return { violations: [] };

  const rules = await ContraindicationRule.find({
    condition: { $in: chronicConditions },
    forbiddenDrugs: { $in: drugNames },
  });

  const violations = [];
  for (const rule of rules) {
    for (const drug of drugNames) {
      if (rule.forbiddenDrugs.includes(drug)) {
        violations.push({
          drug,
          condition: rule.condition,
          severity: rule.severity,
          description: rule.description,
        });
      }
    }
  }

  return { violations };
};

/**
 * Check for interactions between newDrugNames and drugs from the resident's other active prescriptions.
 * @returns {{ interactions: Array<{ drugA, drugB, severity, description }> }}
 */
const checkDrugInteractions = async (residentId, newDrugNames, excludePrescriptionId) => {
  if (!newDrugNames.length) return { interactions: [] };

  const filter = { residentId, status: 'ACTIVE' };
  if (excludePrescriptionId) filter._id = { $ne: excludePrescriptionId };

  const activePrescriptions = await Prescription.find(filter).select('items');

  const existingDrugNames = [];
  for (const rx of activePrescriptions) {
    for (const item of rx.items) {
      if (item.isActive && item.medicationName) {
        existingDrugNames.push(item.medicationName);
      }
    }
  }

  if (!existingDrugNames.length) return { interactions: [] };

  const interactions = await DrugInteraction.find({
    $or: [
      { drugA: { $in: newDrugNames }, drugB: { $in: existingDrugNames } },
      { drugA: { $in: existingDrugNames }, drugB: { $in: newDrugNames } },
    ],
  });

  return {
    interactions: interactions.map((i) => ({
      drugA: i.drugA,
      drugB: i.drugB,
      severity: i.severity,
      description: i.description,
    })),
  };
};

/**
 * Hard-block check: return any drug that matches (case-insensitive) an allergy entry.
 * @returns {{ allergies: Array<{ drug, allergyNote }> }}
 */
const checkAllergies = async (residentId, drugNames) => {
  const resident = await getResidentOrThrow(residentId);
  const { allergies } = resident;

  if (!allergies.length || !drugNames.length) return { allergies: [] };

  const results = [];
  for (const drug of drugNames) {
    const drugLower = drug.toLowerCase();
    for (const allergyNote of allergies) {
      if (allergyNote.toLowerCase().includes(drugLower)) {
        results.push({ drug, allergyNote });
        break;
      }
    }
  }

  return { allergies: results };
};

/**
 * Check if prescribed daily doses exceed elderly-safe maximums (only for residents aged 65+).
 * Each item must have: { medicationName, dosage (numeric), frequency (1–4), unit }
 * @returns {{ warnings: Array<{ medicationName, prescribed, maxRecommended, unit, notes }> }}
 */
const checkElderlyDosage = async (residentId, items) => {
  if (!items.length) return { warnings: [] };

  const resident = await getResidentOrThrow(residentId);

  if (!resident.dateOfBirth) return { warnings: [] };

  const ageYears = (Date.now() - new Date(resident.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (ageYears < 65) return { warnings: [] };

  const drugNames = items.map((i) => i.medicationName);
  const guidelines = await ElderlyDosageGuideline.find({ medicationName: { $in: drugNames } });
  const guidelineMap = Object.fromEntries(guidelines.map((g) => [g.medicationName, g]));

  const warnings = [];
  for (const item of items) {
    const guide = guidelineMap[item.medicationName];
    if (!guide) continue;

    const dailyDose = Number(item.dosage) * Number(item.frequency);
    if (dailyDose > guide.maxDailyDose) {
      warnings.push({
        medicationName: item.medicationName,
        prescribed: dailyDose,
        maxRecommended: guide.maxDailyDose,
        unit: guide.unit,
        notes: guide.notes,
      });
    }
  }

  return { warnings };
};

module.exports = {
  checkContraindications,
  checkDrugInteractions,
  checkAllergies,
  checkElderlyDosage,
};

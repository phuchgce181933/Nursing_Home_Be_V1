require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const ContraindicationRule = require('../models/ContraindicationRule');
const DrugInteraction = require('../models/DrugInteraction');
const ElderlyDosageGuideline = require('../models/ElderlyDosageGuideline');

// ── 15 common elderly drugs ──────────────────────────────────────────────────
const DOSAGE_GUIDELINES = [
  { medicationName: 'Metformin',       maxDailyDose: 2000,  unit: 'mg',  notes: 'Reduce dose when eGFR 30–45; stop when eGFR < 30' },
  { medicationName: 'Warfarin',        maxDailyDose: 10,    unit: 'mg',  notes: 'Titrate to INR 2–3; elderly highly sensitive' },
  { medicationName: 'Aspirin',         maxDailyDose: 100,   unit: 'mg',  notes: 'Low-dose antiplatelet only; avoid high doses in elderly' },
  { medicationName: 'Digoxin',         maxDailyDose: 0.125, unit: 'mg',  notes: 'Halve standard dose in elderly; monitor drug level' },
  { medicationName: 'Amiodarone',      maxDailyDose: 200,   unit: 'mg',  notes: 'Maintenance dose; monitor thyroid and lung function' },
  { medicationName: 'Lisinopril',      maxDailyDose: 10,    unit: 'mg',  notes: 'ACE inhibitor; start low, monitor potassium and creatinine' },
  { medicationName: 'Enalapril',       maxDailyDose: 20,    unit: 'mg',  notes: 'ACE inhibitor; halve starting dose in elderly' },
  { medicationName: 'Amlodipine',      maxDailyDose: 5,     unit: 'mg',  notes: 'Calcium channel blocker; 5 mg max in elderly to avoid hypotension' },
  { medicationName: 'Atorvastatin',    maxDailyDose: 40,    unit: 'mg',  notes: 'Avoid 80 mg dose in elderly; monitor muscle symptoms' },
  { medicationName: 'Furosemide',      maxDailyDose: 40,    unit: 'mg',  notes: 'Monitor electrolytes and renal function closely' },
  { medicationName: 'Omeprazole',      maxDailyDose: 20,    unit: 'mg',  notes: 'Long-term use increases fracture and hypomagnesaemia risk' },
  { medicationName: 'Ibuprofen',       maxDailyDose: 1200,  unit: 'mg',  notes: 'NSAID; avoid in heart failure, CKD; use shortest duration' },
  { medicationName: 'Naproxen',        maxDailyDose: 500,   unit: 'mg',  notes: 'NSAID; lower GI risk than ibuprofen but similar renal risk' },
  { medicationName: 'Prednisolone',    maxDailyDose: 10,    unit: 'mg',  notes: 'Maintenance dose; monitor bone density and blood sugar' },
  { medicationName: 'Losartan',        maxDailyDose: 50,    unit: 'mg',  notes: 'ARB; start 25 mg in elderly; monitor potassium' },
];

// ── Contraindication rules ───────────────────────────────────────────────────
const CONTRAINDICATION_RULES = [
  {
    condition: 'RENAL_FAILURE',
    forbiddenDrugs: ['Metformin', 'Digoxin'],
    severity: 'CRITICAL',
    description: 'Metformin accumulates causing lactic acidosis; Digoxin toxicity risk increases when eGFR < 30',
  },
  {
    condition: 'HEART_FAILURE',
    forbiddenDrugs: ['Ibuprofen', 'Naproxen'],
    severity: 'HIGH',
    description: 'NSAIDs cause fluid retention and worsen cardiac output; may precipitate acute decompensation',
  },
  {
    condition: 'LIVER_DISEASE',
    forbiddenDrugs: ['Warfarin'],
    severity: 'HIGH',
    description: 'Impaired hepatic synthesis of clotting factors amplifies Warfarin anticoagulant effect unpredictably',
  },
  {
    condition: 'HYPERKALEMIA',
    forbiddenDrugs: ['Lisinopril', 'Enalapril', 'Losartan'],
    severity: 'HIGH',
    description: 'ACE inhibitors and ARBs further raise serum potassium, increasing risk of fatal arrhythmia',
  },
  {
    condition: 'PEPTIC_ULCER',
    forbiddenDrugs: ['Ibuprofen', 'Naproxen', 'Aspirin'],
    severity: 'HIGH',
    description: 'NSAIDs and Aspirin inhibit COX-1, reducing gastroprotective prostaglandins and worsening ulcers',
  },
];

// ── Drug interactions ────────────────────────────────────────────────────────
const DRUG_INTERACTIONS = [
  {
    drugA: 'Warfarin',
    drugB: 'Aspirin',
    severity: 'SEVERE',
    description: 'Concomitant use greatly increases bleeding risk; Aspirin inhibits platelets while Warfarin affects coagulation cascade',
  },
  {
    drugA: 'Digoxin',
    drugB: 'Amiodarone',
    severity: 'SEVERE',
    description: 'Amiodarone inhibits P-glycoprotein and CYP3A4, raising Digoxin plasma levels up to twofold; reduce Digoxin dose by 50%',
  },
  {
    drugA: 'Metformin',
    drugB: 'Contrast dye',
    severity: 'SEVERE',
    description: 'Iodinated contrast media can acutely impair renal function, causing Metformin accumulation and lactic acidosis',
  },
  {
    drugA: 'Warfarin',
    drugB: 'Amiodarone',
    severity: 'SEVERE',
    description: 'Amiodarone inhibits CYP2C9, the main enzyme metabolising Warfarin; INR can increase dramatically',
  },
  {
    drugA: 'Lisinopril',
    drugB: 'Losartan',
    severity: 'MODERATE',
    description: 'Dual RAAS blockade increases risk of hypotension, hyperkalemia, and acute kidney injury',
  },
  {
    drugA: 'Furosemide',
    drugB: 'Digoxin',
    severity: 'MODERATE',
    description: 'Furosemide-induced hypokalemia potentiates Digoxin toxicity; monitor potassium closely',
  },
  {
    drugA: 'Atorvastatin',
    drugB: 'Amiodarone',
    severity: 'MODERATE',
    description: 'Amiodarone inhibits CYP3A4 raising statin exposure; increased risk of myopathy and rhabdomyolysis',
  },
  {
    drugA: 'Aspirin',
    drugB: 'Ibuprofen',
    severity: 'MODERATE',
    description: 'Ibuprofen competitively blocks the COX-1 active site, reducing the antiplatelet effect of low-dose Aspirin',
  },
];

// ── Seed function ────────────────────────────────────────────────────────────
const seed = async () => {
  await connectDB();

  console.log('Clearing existing medication reference data...');
  await Promise.all([
    ElderlyDosageGuideline.deleteMany({}),
    ContraindicationRule.deleteMany({}),
    DrugInteraction.deleteMany({}),
  ]);

  console.log('Seeding ElderlyDosageGuidelines (15 drugs)...');
  await ElderlyDosageGuideline.insertMany(DOSAGE_GUIDELINES);

  console.log('Seeding ContraindicationRules...');
  await ContraindicationRule.insertMany(CONTRAINDICATION_RULES);

  console.log('Seeding DrugInteractions...');
  await DrugInteraction.insertMany(DRUG_INTERACTIONS);

  console.log('\n========================================');
  console.log('MEDICATION SEED COMPLETED');
  console.log('========================================');
  console.log(`  ElderlyDosageGuidelines : ${DOSAGE_GUIDELINES.length}`);
  console.log(`  ContraindicationRules   : ${CONTRAINDICATION_RULES.length}`);
  console.log(`  DrugInteractions        : ${DRUG_INTERACTIONS.length}`);
  console.log('========================================\n');

  await mongoose.disconnect();
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

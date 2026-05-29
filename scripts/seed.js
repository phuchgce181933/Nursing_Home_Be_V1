// Seed script — run once to populate sample data. NOT for production.
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/user');
const StaffProfile = require('../models/staffProfile');
const Resident = require('../models/resident');
const Prescription = require('../models/prescription');
const MedicationAdministration = require('../models/medicationAdministration');
const connectDB = require('../config/db');

// ── helpers ────────────────────────────────────────────────────────────────

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const atTime = (baseDate, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(baseDate);
  d.setHours(h, m, 0, 0);
  return d;
};

// Build administration records for a prescription over a date range
const buildAdmins = (prescription, residentId, staffId, daysBack, daysForward = 3) => {
  const records = [];
  const now = new Date();

  for (let offset = -daysBack; offset <= daysForward; offset++) {
    const base = new Date(now);
    base.setDate(now.getDate() + offset);
    base.setHours(0, 0, 0, 0);

    for (const time of prescription._scheduleTimes) {
      const scheduledAt = atTime(base, time);
      const isPast = scheduledAt < now;
      const isToday = offset === 0;

      let status = 'pending';
      let takenAt = null;
      let administeredByStaffId = null;
      let notes = '';

      if (isPast && !isToday) {
        // Historical: mostly taken, some missed
        const roll = Math.random();
        if (roll < 0.75) {
          status = 'taken';
          takenAt = new Date(scheduledAt.getTime() + Math.floor(Math.random() * 10 + 1) * 60000);
          administeredByStaffId = staffId;
        } else if (roll < 0.90) {
          status = 'missed';
          notes = ['Resident refused', 'Resident sleeping', 'Medication unavailable'][Math.floor(Math.random() * 3)];
        } else {
          status = 'overdue';
        }
      } else if (isToday && isPast) {
        // Today but already past the scheduled time
        const roll = Math.random();
        if (roll < 0.5) {
          status = 'taken';
          takenAt = new Date(scheduledAt.getTime() + Math.floor(Math.random() * 15 + 1) * 60000);
          administeredByStaffId = staffId;
        } else if (roll < 0.7) {
          status = 'overdue';
        } else {
          status = 'pending';
        }
      }
      // future = pending (default)

      records.push({
        prescriptionId: prescription._id,
        residentId,
        scheduledAt,
        status,
        takenAt,
        administeredByStaffId: administeredByStaffId || undefined,
        notes,
      });
    }
  }
  return records;
};

// ── seed emails / codes to clean up ────────────────────────────────────────

const SEED_EMAILS = [
  'admin@test.com', 'manager@test.com',
  'doctor@test.com', 'doctor2@test.com',
  'nurse@test.com', 'nurse2@test.com',
  'family@test.com',
  'family1b@test.com',
  'family2@test.com',
  'family3@test.com',
  'family4@test.com',
  'family5@test.com',
  'admin@gmail.com',
  'manager@gmail.com',
  'doctor@gmail.com',
];
const SEED_STAFF_CODES = ['ADM001', 'MGR001', 'DOC001', 'DOC002', 'NUR001', 'NUR002'];
const SEED_RESIDENT_CODES = ['RES001', 'RES002', 'RES003', 'RES004', 'RES005', 'RES006'];

// ── main ────────────────────────────────────────────────────────────────────

const seed = async () => {
  await connectDB();

  console.log('Clearing old seed data...');
  const existingBuilding = await Building.findOne({ code: SEED_BUILDING_CODE });
  if (existingBuilding) {
    const existingFloors = await Floor.find({ buildingId: existingBuilding._id });
    const floorIds = existingFloors.map((f) => f._id);
    const existingRooms = await Room.find({ floorId: { $in: floorIds } });
    const roomIds = existingRooms.map((r) => r._id);
    await Bed.deleteMany({ roomId: { $in: roomIds } });
    await Room.deleteMany({ floorId: { $in: floorIds } });
    await Floor.deleteMany({ buildingId: existingBuilding._id });
    await Building.deleteOne({ _id: existingBuilding._id });
  }
  await User.deleteMany({ email: { $in: SEED_EMAILS } });
  await StaffProfile.deleteMany({ staffCode: { $in: SEED_STAFF_CODES } });
  await Resident.deleteMany({ residentCode: { $in: SEED_RESIDENT_CODES } });

  // clean prescriptions/admins referencing our seed residents (cascade-like)
  // We'll drop them all and re-create below
  const pw = await bcrypt.hash('password123', 10);

  // ── Users ────────────────────────────────────────────────────────────────

  console.log('Creating users...');
  const [admin, manager, doctor1, doctor2, nurse1, nurse2, family] = await User.insertMany([
    { fullName: 'Admin System',         email: 'admin@test.com',   username: 'admin_test',   passwordHash: pw, role: 'admin',   isActive: true },
    { fullName: 'Manager Nguyen Van B', email: 'manager@test.com', username: 'manager_test', passwordHash: pw, role: 'manager', isActive: true },
    { fullName: 'Dr. Nguyen Van A',     email: 'doctor@test.com',  username: 'doctor_test',  passwordHash: pw, role: 'doctor',  phone: '0901000001', isActive: true },
    { fullName: 'Dr. Le Van Hung',      email: 'doctor2@test.com', username: 'doctor2_test', passwordHash: pw, role: 'doctor',  phone: '0901000002', isActive: true },
    { fullName: 'Nurse Tran Thi B',     email: 'nurse@test.com',   username: 'nurse_test',   passwordHash: pw, role: 'nurse',   phone: '0902000001', isActive: true },
    { fullName: 'Nurse Pham Van C',     email: 'nurse2@test.com',  username: 'nurse2_test',  passwordHash: pw, role: 'nurse',   phone: '0902000002', isActive: true },
    { fullName: 'Family Le Van C',      email: 'family@test.com',  username: 'family_test',  passwordHash: pw, role: 'family',  isActive: true },
  ]);

  // ── Residents ─────────────────────────────────────────────────────────────

  console.log('Creating residents...');
  const [res1, res2, res3, res4, res5, res6] = await Resident.insertMany([
    {
      residentCode: 'RES001',
      fullName: 'Cụ Nguyễn Thị D',
      dateOfBirth: new Date('1940-03-15'),
      gender: 'female',
      bloodType: 'A+',
      allergies: ['Penicillin', 'Sulfonamides'],
      chronicConditions: ['Type 2 Diabetes', 'Hypertension'],
      initialHealthCondition: 'Stable, requires daily medication monitoring',
      residencyStatus: 'admitted',
      admittedAt: new Date('2024-06-01'),
      familyPortalAccountIds: [family._id],
    },
    {
      residentCode: 'RES002',
      fullName: 'Ông Trần Văn E',
      dateOfBirth: new Date('1938-07-22'),
      gender: 'male',
      bloodType: 'B+',
      allergies: ['Aspirin', 'NSAIDs'],
      chronicConditions: ['Heart Failure', 'Atrial Fibrillation', 'CKD Stage 3'],
      initialHealthCondition: 'Requires close cardiac monitoring',
      residencyStatus: 'admitted',
      admittedAt: new Date('2024-08-10'),
      familyPortalAccountIds: [],
    },
    {
      residentCode: 'RES003',
      fullName: 'Bà Lê Thị F',
      dateOfBirth: new Date('1942-11-05'),
      gender: 'female',
      bloodType: 'O+',
      allergies: [],
      chronicConditions: ['Hyperlipidemia', 'Osteoporosis'],
      initialHealthCondition: 'Good general condition, on cholesterol medication',
      residencyStatus: 'admitted',
      admittedAt: new Date('2024-09-15'),
      familyPortalAccountIds: [],
    },
    {
      residentCode: 'RES004',
      fullName: 'Cụ Phạm Văn G',
      dateOfBirth: new Date('1935-04-18'),
      gender: 'male',
      bloodType: 'AB+',
      allergies: ['Codeine', 'Latex'],
      chronicConditions: ['Parkinson\'s Disease', 'Dementia', 'Hypertension'],
      initialHealthCondition: 'Requires full-time nursing care',
      residencyStatus: 'admitted',
      admittedAt: new Date('2024-05-20'),
      familyPortalAccountIds: [],
    },
  ]);

  const familyPortalIds = {
    RES001: [family1._id, family1b._id],
    RES002: [family2._id],
    RES003: [family3._id],
    RES004: [family4._id],
    RES005: [family5._id],
  };

  console.log('Creating staff profiles...');
  const [, , doctorProfile, nurseProfile] = await StaffProfile.insertMany([
    { userId: admin._id, staffCode: 'ADM001', roleCategory: 'admin', specialty: 'Administration' },
    { userId: manager._id, staffCode: 'MGR001', roleCategory: 'manager', specialty: 'Operations Management' },
    { userId: doctor._id, staffCode: 'DOC001', roleCategory: 'doctor', specialty: 'General Medicine' },
    { userId: nurse._id, staffCode: 'NUR001', roleCategory: 'nurse', specialty: 'Care Nursing' },
    { userId: adminGmail._id, staffCode: 'ADM002', roleCategory: 'admin', specialty: 'Administration' },
    { userId: managerGmail._id, staffCode: 'MGR002', roleCategory: 'manager', specialty: 'Operations Management' },
    { userId: doctorGmail._id, staffCode: 'DOC002', roleCategory: 'doctor', specialty: 'General Medicine' },
  ]);

  console.log('Creating building, floors and rooms...');
  const building = await Building.create({
    code: SEED_BUILDING_CODE,
    name: 'Tòa điều dưỡng chính',
    address: '123 Đường Y Tế, Quận 1',
    description: 'Tòa nhà mẫu dùng cho seed',
    isActive: true,
  });

  const [floor1, floor2] = await Floor.insertMany([
    {
      residentCode: 'RES005',
      fullName: 'Bà Hoàng Thị H',
      dateOfBirth: new Date('1945-09-30'),
      gender: 'female',
      bloodType: 'A-',
      allergies: ['Ibuprofen'],
      chronicConditions: ['Rheumatoid Arthritis', 'Type 2 Diabetes'],
      initialHealthCondition: 'Mobile with assistance, on immunosuppressants',
      residencyStatus: 'admitted',
      admittedAt: new Date('2024-11-01'),
      familyPortalAccountIds: [],
    },
    {
      residentCode: 'RES006',
      fullName: 'Cụ Võ Văn K',
      dateOfBirth: new Date('1932-12-10'),
      gender: 'male',
      bloodType: 'O-',
      allergies: ['Morphine'],
      chronicConditions: ['COPD', 'Type 2 Diabetes', 'Hypertension'],
      initialHealthCondition: 'Requires oxygen support and regular spirometry',
      residencyStatus: 'admitted',
      admittedAt: new Date('2025-01-15'),
      familyPortalAccountIds: [],
    },
  ]);

  // ── Staff Profiles (with assignedResidentIds) ─────────────────────────────

  console.log('Creating staff profiles...');
  // Doctor 1 manages res1, res2, res3 — Nurse 1 also covers these
  // Doctor 2 manages res4, res5, res6 — Nurse 2 also covers these
  const [, , doctorProfile1, doctorProfile2, nurseProfile1, nurseProfile2] = await StaffProfile.insertMany([
    { userId: admin._id,   staffCode: 'ADM001', roleCategory: 'admin',   specialty: 'Administration',      assignedResidentIds: [] },
    { userId: manager._id, staffCode: 'MGR001', roleCategory: 'manager', specialty: 'Operations Management', assignedResidentIds: [] },
    { userId: doctor1._id, staffCode: 'DOC001', roleCategory: 'doctor',  specialty: 'Internal Medicine',    certifications: ['BLS', 'ACLS'], assignedResidentIds: [res1._id, res2._id, res3._id] },
    { userId: doctor2._id, staffCode: 'DOC002', roleCategory: 'doctor',  specialty: 'General Medicine',     certifications: ['BLS'], assignedResidentIds: [res4._id, res5._id, res6._id] },
    { userId: nurse1._id,  staffCode: 'NUR001', roleCategory: 'nurse',   specialty: 'Care Nursing',         certifications: ['BLS', 'First Aid'], assignedResidentIds: [res1._id, res2._id, res3._id] },
    { userId: nurse2._id,  staffCode: 'NUR002', roleCategory: 'nurse',   specialty: 'Care Nursing',         certifications: ['BLS'], assignedResidentIds: [res4._id, res5._id, res6._id] },
  ]);

  // ── Prescriptions ─────────────────────────────────────────────────────────

  console.log('Creating prescriptions...');

  // Attach schedule times so buildAdmins can read them
  const prescriptionData = [
    // RES001 — Dr1
    { residentId: res1._id, prescribedByStaffId: doctorProfile1._id, medicationName: 'Metformin', dosage: '500mg', route: 'Oral', frequency: 'Twice daily', startDate: daysAgo(60), endDate: null, scheduleTimes: ['07:00', '19:00'], status: 'active', notes: 'Take after meals. Monitor blood glucose.' },
    { residentId: res1._id, prescribedByStaffId: doctorProfile1._id, medicationName: 'Amlodipine', dosage: '5mg', route: 'Oral', frequency: 'Once daily', startDate: daysAgo(45), endDate: null, scheduleTimes: ['08:00'], status: 'active', notes: 'Monitor blood pressure weekly.' },
    // RES002 — Dr1
    { residentId: res2._id, prescribedByStaffId: doctorProfile1._id, medicationName: 'Bisoprolol', dosage: '5mg', route: 'Oral', frequency: 'Once daily', startDate: daysAgo(30), endDate: null, scheduleTimes: ['08:00'], status: 'active', notes: 'Do not stop abruptly. Monitor HR.' },
    { residentId: res2._id, prescribedByStaffId: doctorProfile1._id, medicationName: 'Furosemide', dosage: '40mg', route: 'Oral', frequency: 'Once daily (morning)', startDate: daysAgo(20), endDate: null, scheduleTimes: ['07:30'], status: 'active', notes: 'Monitor fluid balance and potassium.' },
    { residentId: res2._id, prescribedByStaffId: doctorProfile1._id, medicationName: 'Warfarin', dosage: '2mg', route: 'Oral', frequency: 'Once daily', startDate: daysAgo(25), endDate: null, scheduleTimes: ['18:00'], status: 'active', notes: 'Check INR monthly. Risk of bleeding.' },
    // RES003 — Dr1
    { residentId: res3._id, prescribedByStaffId: doctorProfile1._id, medicationName: 'Atorvastatin', dosage: '20mg', route: 'Oral', frequency: 'Once daily (evening)', startDate: daysAgo(50), endDate: null, scheduleTimes: ['20:00'], status: 'active', notes: 'Take in the evening.' },
    { residentId: res3._id, prescribedByStaffId: doctorProfile1._id, medicationName: 'Calcium + Vit D3', dosage: '600mg/400IU', route: 'Oral', frequency: 'Twice daily', startDate: daysAgo(30), endDate: null, scheduleTimes: ['09:00', '21:00'], status: 'active', notes: 'Take with food.' },
    // RES004 — Dr2
    { residentId: res4._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Levodopa/Carbidopa', dosage: '100/25mg', route: 'Oral', frequency: 'Three times daily', startDate: daysAgo(90), endDate: null, scheduleTimes: ['07:00', '13:00', '19:00'], status: 'active', notes: 'Parkinson\'s. Do NOT take with high-protein meals.' },
    { residentId: res4._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Rivastigmine', dosage: '3mg', route: 'Oral', frequency: 'Twice daily', startDate: daysAgo(60), endDate: null, scheduleTimes: ['08:00', '20:00'], status: 'active', notes: 'Take with meals. Watch for nausea.' },
    { residentId: res4._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Lisinopril', dosage: '5mg', route: 'Oral', frequency: 'Once daily', startDate: daysAgo(45), endDate: null, scheduleTimes: ['09:00'], status: 'paused', notes: 'Paused: BP too low this week.' },
    // RES005 — Dr2
    { residentId: res5._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Methotrexate', dosage: '10mg', route: 'Oral', frequency: 'Once weekly (Monday)', startDate: daysAgo(30), endDate: null, scheduleTimes: ['09:00'], status: 'active', notes: 'Weekly dose. Monitor LFTs monthly. Folic acid must be co-prescribed.' },
    { residentId: res5._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Folic Acid', dosage: '5mg', route: 'Oral', frequency: 'Once daily (not on Methotrexate day)', startDate: daysAgo(30), endDate: null, scheduleTimes: ['08:00'], status: 'active', notes: 'Co-prescribed with Methotrexate.' },
    { residentId: res5._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Glipizide', dosage: '5mg', route: 'Oral', frequency: 'Twice daily', startDate: daysAgo(40), endDate: null, scheduleTimes: ['07:00', '18:00'], status: 'active', notes: 'Take 30 min before meals. Watch for hypoglycemia.' },
    // RES006 — Dr2
    { residentId: res6._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Tiotropium', dosage: '18mcg', route: 'Inhalation', frequency: 'Once daily', startDate: daysAgo(20), endDate: null, scheduleTimes: ['08:00'], status: 'active', notes: 'COPD maintenance. Teach proper inhaler technique.' },
    { residentId: res6._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Salbutamol', dosage: '100mcg/puff', route: 'Inhalation', frequency: 'PRN (as needed)', startDate: daysAgo(20), endDate: null, scheduleTimes: ['08:00', '20:00'], status: 'active', notes: 'Rescue inhaler. Max 4 puffs/4h.' },
  ];

  // Save _scheduleTimes on each for buildAdmins, then strip before save
  const prescriptions = [];
  for (const data of prescriptionData) {
    const { scheduleTimes, ...rest } = data;
    const p = await Prescription.create({ ...rest, scheduleTimes });
    p._scheduleTimes = scheduleTimes; // temp property for seed helper
    prescriptions.push(p);
  }

  // ── Medication Administrations (14 days back + 3 days forward) ────────────

  console.log('Creating medication administration records...');
  const allAdminDocs = [];

  const nurseForResident = (resId) => {
    const s = String(resId);
    if ([res1, res2, res3].map((r) => String(r._id)).includes(s)) return nurseProfile1._id;
    return nurseProfile2._id;
  };

  for (const p of prescriptions) {
    const records = buildAdmins(p, p.residentId, nurseForResident(p.residentId), 14, 3);
    allAdminDocs.push(...records);
  }

  await MedicationAdministration.insertMany(allAdminDocs);

  const { ensureDefaultShiftTemplates } = require('../services/defaultShiftBootstrap');
  await ensureDefaultShiftTemplates();

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n========================================');
  console.log('SEED DATA CREATED SUCCESSFULLY');
  console.log('========================================');
  console.log('\n--- Test accounts (password: password123) ---');
  console.log('Admin   : admin@test.com');
  console.log('Manager : manager@test.com');
  console.log('Doctor1 : doctor@test.com   (manages RES001, RES002, RES003)');
  console.log('Doctor2 : doctor2@test.com  (manages RES004, RES005, RES006)');
  console.log('Nurse1  : nurse@test.com    (manages RES001, RES002, RES003)');
  console.log('Nurse2  : nurse2@test.com   (manages RES004, RES005, RES006)');
  console.log('Family  : family@test.com');
  console.log('\n--- Residents ---');
  console.log(`RES001 Cụ Nguyễn Thị D  → ${res1._id}  [Allergy: Penicillin, Sulfonamides]`);
  console.log(`RES002 Ông Trần Văn E   → ${res2._id}  [Allergy: Aspirin, NSAIDs]`);
  console.log(`RES003 Bà Lê Thị F      → ${res3._id}`);
  console.log(`RES004 Cụ Phạm Văn G    → ${res4._id}  [Allergy: Codeine, Latex]`);
  console.log(`RES005 Bà Hoàng Thị H   → ${res5._id}  [Allergy: Ibuprofen]`);
  console.log(`RES006 Cụ Võ Văn K      → ${res6._id}  [Allergy: Morphine]`);
  console.log(`\nTotal administration records: ${allAdminDocs.length}`);
  console.log('========================================\n');

  await mongoose.disconnect();
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

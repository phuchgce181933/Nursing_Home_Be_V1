// Seed script - run once to populate sample data. NOT for production.
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/user');
const StaffProfile = require('../models/staffProfile');
const Resident = require('../models/resident');
const Prescription = require('../models/prescription');
const MedicationAdministration = require('../models/medicationAdministration');
const Building = require('../models/building');
const Floor = require('../models/floor');
const Room = require('../models/room');
const Bed = require('../models/bed');
const connectDB = require('../config/db');

// -- helpers -----------------------------------------------------------------

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

const buildAdmins = (prescription, residentId, staffId, daysBack, daysForward = 3) => {
  const records = [];
  const now = new Date();

  for (let offset = -daysBack; offset <= daysForward; offset += 1) {
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
        const roll = Math.random();
        if (roll < 0.75) {
          status = 'taken';
          takenAt = new Date(scheduledAt.getTime() + Math.floor(Math.random() * 10 + 1) * 60000);
          administeredByStaffId = staffId;
        } else if (roll < 0.9) {
          status = 'missed';
          notes = ['Resident refused', 'Resident sleeping', 'Medication unavailable'][Math.floor(Math.random() * 3)];
        } else {
          status = 'overdue';
        }
      } else if (isToday && isPast) {
        const roll = Math.random();
        if (roll < 0.5) {
          status = 'taken';
          takenAt = new Date(scheduledAt.getTime() + Math.floor(Math.random() * 15 + 1) * 60000);
          administeredByStaffId = staffId;
        } else if (roll < 0.7) {
          status = 'overdue';
        }
      }

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

// -- constants ---------------------------------------------------------------

const SEED_BUILDING_CODE = 'BLD001';

const SEED_EMAILS = [
  'admin@test.com',
  'manager@test.com',
  'doctor@test.com',
  'doctor2@test.com',
  'nurse@test.com',
  'nurse2@test.com',
  'caregiver@test.com',
  'chef@test.com',
  'family@test.com',
  'family2@test.com',
  'family3@test.com',
  'family4@test.com',
  'family5@test.com',
  'admin@gmail.com',
  'doctor@gmail.com',
  'nurse@gmail.com',
  'caregiver@gmail.com',
];

const SEED_STAFF_CODES = ['ADM001', 'MGR001', 'DOC001', 'DOC002', 'NUR001', 'NUR002', 'CAR001', 'CHE001', 'ADM002', 'DOC003', 'NUR003', 'CAR002'];
const SEED_RESIDENT_CODES = ['RES001', 'RES002', 'RES003', 'RES004', 'RES005', 'RES006'];
const SEED_REHAB_TITLE = 'Lịch PHCN (seed)';

const addDaysToDateStr = (dateStr, days) => {
  const base = new Date(`${dateStr}T12:00:00+07:00`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
};

const seedRehabilitationSchedules = async (nurseUser, residents) => {
  const RehabilitationScheduleDay = require('../models/rehabilitationScheduleDay');
  const RehabilitationScheduleEntry = require('../models/rehabilitationScheduleEntry');
  const { todayVN } = require('../utils/shiftTime');

  await RehabilitationScheduleEntry.deleteMany({});
  await RehabilitationScheduleDay.deleteMany({ title: SEED_REHAB_TITLE });

  const workDates = [todayVN(), addDaysToDateStr(todayVN(), 1)];
  const sessionTemplates = [
    {
      sessionType: 'physical_therapy',
      scheduledTime: '09:00',
      durationMinutes: 45,
      location: 'Phòng PHCN tầng 1',
      sessionTitle: 'Vận động trị liệu',
      therapyGoals: 'Duy trì khả năng vận động tay chân',
      caregiverAssistNote: 'Đón cư dân lúc 8:45, đưa về phòng sau buổi',
      leadStaffName: 'KTV Nguyễn Văn A',
    },
    {
      sessionType: 'mobility_training',
      scheduledTime: '14:30',
      durationMinutes: 30,
      location: 'Sân vận động',
      sessionTitle: 'Tập đi lại',
      therapyGoals: 'Cải thiện thăng bằng và sức bền',
      caregiverAssistNote: 'Chuẩn bị xe lăn, hỗ trợ mặc giày an toàn',
      leadStaffName: 'KTV Trần Thị B',
    },
  ];

  for (const wd of workDates) {
    const day = await RehabilitationScheduleDay.create({
      workDate: new Date(`${wd}T00:00:00.000Z`),
      title: SEED_REHAB_TITLE,
      status: 'published',
      createdBy: nurseUser._id,
      publishedBy: nurseUser._id,
      publishedAt: new Date(),
    });

    const entryDocs = [];
    for (const res of residents) {
      for (const tpl of sessionTemplates) {
        entryDocs.push({
          ...tpl,
          rehabilitationScheduleDayId: day._id,
          residentId: res._id,
        });
      }
    }
    await RehabilitationScheduleEntry.insertMany(entryDocs);
  }

  console.log(`Rehabilitation schedules seeded for ${workDates.join(', ')} (${residents.length} residents)`);
};

// -- main --------------------------------------------------------------------

const seed = async () => {
  await connectDB();

  console.log('Clearing old seed data...');

  const existingResidents = await Resident.find({ residentCode: { $in: SEED_RESIDENT_CODES } }).select('_id');
  const residentIds = existingResidents.map((r) => r._id);

  if (residentIds.length > 0) {
    await MedicationAdministration.deleteMany({ residentId: { $in: residentIds } });
    await Prescription.deleteMany({ residentId: { $in: residentIds } });
  }

  const existingBuilding = await Building.findOne({ code: SEED_BUILDING_CODE });
  if (existingBuilding) {
    const existingFloors = await Floor.find({ buildingId: existingBuilding._id }).select('_id');
    const floorIds = existingFloors.map((f) => f._id);
    const existingRooms = await Room.find({ floorId: { $in: floorIds } }).select('_id');
    const roomIds = existingRooms.map((r) => r._id);

    await Bed.deleteMany({ roomId: { $in: roomIds } });
    await Room.deleteMany({ floorId: { $in: floorIds } });
    await Floor.deleteMany({ buildingId: existingBuilding._id });
    await Building.deleteOne({ _id: existingBuilding._id });
  }

  await StaffProfile.deleteMany({ staffCode: { $in: SEED_STAFF_CODES } });
  await User.deleteMany({ email: { $in: SEED_EMAILS } });
  await Resident.deleteMany({ residentCode: { $in: SEED_RESIDENT_CODES } });

  const pw = await bcrypt.hash('password123', 10);
  const pwSimple = await bcrypt.hash('12345678', 10);

  console.log('Creating users...');
  const [
    admin,
    manager,
    doctor1,
    doctor2,
    nurse1,
    nurse2,
    caregiver1,
    chef1,
    family1,
    family2,
    family3,
    family4,
    family5,
    adminGmail,
    doctorGmail,
    nurseGmail,
    caregiverGmail,
  ] = await User.insertMany([
    { fullName: 'Admin System', email: 'admin@test.com', username: 'admin_test', passwordHash: pw, role: 'admin', isActive: true },
    { fullName: 'Manager Nguyen Van B', email: 'manager@test.com', username: 'manager_test', passwordHash: pw, role: 'manager', isActive: true },
    { fullName: 'Dr. Nguyen Van A', email: 'doctor@test.com', username: 'doctor_test', passwordHash: pw, role: 'doctor', phone: '0901000001', isActive: true },
    { fullName: 'Dr. Le Van Hung', email: 'doctor2@test.com', username: 'doctor2_test', passwordHash: pw, role: 'doctor', phone: '0901000002', isActive: true },
    { fullName: 'Nurse Tran Thi B', email: 'nurse@test.com', username: 'nurse_test', passwordHash: pw, role: 'nurse', phone: '0902000001', isActive: true },
    { fullName: 'Nurse Pham Van C', email: 'nurse2@test.com', username: 'nurse2_test', passwordHash: pw, role: 'nurse', phone: '0902000002', isActive: true },
    { fullName: 'Caregiver Hoang Van D', email: 'caregiver@test.com', username: 'caregiver_test', passwordHash: pw, role: 'caregiver', phone: '0903000001', isActive: true },
    { fullName: 'Dau Bep Nguyen Van H', email: 'chef@test.com', username: 'chef_test', passwordHash: pw, role: 'chef', phone: '0904000001', isActive: true },
    { fullName: 'Family Le Van C', email: 'family@test.com', username: 'family_test', passwordHash: pw, role: 'family', isActive: true },
    { fullName: 'Family Tran Thi D', email: 'family2@test.com', username: 'family2_test', passwordHash: pw, role: 'family', isActive: true },
    { fullName: 'Family Nguyen Van E', email: 'family3@test.com', username: 'family3_test', passwordHash: pw, role: 'family', isActive: true },
    { fullName: 'Family Hoang Thi F', email: 'family4@test.com', username: 'family4_test', passwordHash: pw, role: 'family', isActive: true },
    { fullName: 'Family Pham Van G', email: 'family5@test.com', username: 'family5_test', passwordHash: pw, role: 'family', isActive: true },
    { fullName: 'Admin Gmail', email: 'admin@gmail.com', username: 'admin_gmail', passwordHash: pwSimple, role: 'admin', isActive: true },
    { fullName: 'Doctor Gmail', email: 'doctor@gmail.com', username: 'doctor_gmail', passwordHash: pwSimple, role: 'doctor', isActive: true },
    { fullName: 'Nurse Gmail', email: 'nurse@gmail.com', username: 'nurse_gmail', passwordHash: pwSimple, role: 'nurse', isActive: true },
    { fullName: 'Caregiver Gmail', email: 'caregiver@gmail.com', username: 'caregiver_gmail', passwordHash: pwSimple, role: 'caregiver', isActive: true },
  ]);

  console.log('Creating building, floors, rooms and beds...');
  const building = await Building.create({
    code: SEED_BUILDING_CODE,
    name: 'Toa dieu duong chinh',
    address: '123 Duong Y Te, Quan 1',
    description: 'Toa nha mau dung cho seed',
    isActive: true,
  });

  const [floor1, floor2] = await Floor.insertMany([
    { buildingId: building._id, floorNumber: 1, name: 'Tang 1', description: 'Khu noi tru', isActive: true },
    { buildingId: building._id, floorNumber: 2, name: 'Tang 2', description: 'Khu cham soc dac biet', isActive: true },
  ]);

  const [room101, room102, room103, room104, room201, room202, room203, room204] = await Room.insertMany([
    { buildingId: building._id, floorId: floor1._id, roomNumber: '101', roomType: 'standard', capacity: 1, occupiedCount: 1, status: 'full' },
    { buildingId: building._id, floorId: floor1._id, roomNumber: '102', roomType: 'standard', capacity: 1, occupiedCount: 1, status: 'full' },
    { buildingId: building._id, floorId: floor1._id, roomNumber: '103', roomType: 'standard', capacity: 1, occupiedCount: 1, status: 'full' },
    { buildingId: building._id, floorId: floor1._id, roomNumber: '104', roomType: 'standard', capacity: 1, occupiedCount: 0, status: 'available' },
    { buildingId: building._id, floorId: floor2._id, roomNumber: '201', roomType: 'premium', capacity: 1, occupiedCount: 1, status: 'full' },
    { buildingId: building._id, floorId: floor2._id, roomNumber: '202', roomType: 'premium', capacity: 1, occupiedCount: 1, status: 'full' },
    { buildingId: building._id, floorId: floor2._id, roomNumber: '203', roomType: 'premium', capacity: 1, occupiedCount: 1, status: 'full' },
    { buildingId: building._id, floorId: floor2._id, roomNumber: '204', roomType: 'premium', capacity: 1, occupiedCount: 0, status: 'available' },
  ]);

  const [bed101A, bed102A, bed103A, bed104A, bed201A, bed202A, bed203A, bed204A] = await Bed.insertMany([
    { roomId: room101._id, bedCode: '101-A', bedType: 'normal', status: 'occupied', condition: 'good' },
    { roomId: room102._id, bedCode: '102-A', bedType: 'normal', status: 'occupied', condition: 'good' },
    { roomId: room103._id, bedCode: '103-A', bedType: 'normal', status: 'occupied', condition: 'good' },
    { roomId: room104._id, bedCode: '104-A', bedType: 'normal', status: 'available', condition: 'good' },
    { roomId: room201._id, bedCode: '201-A', bedType: 'electric', status: 'occupied', condition: 'good' },
    { roomId: room202._id, bedCode: '202-A', bedType: 'electric', status: 'occupied', condition: 'good' },
    { roomId: room203._id, bedCode: '203-A', bedType: 'electric', status: 'occupied', condition: 'good' },
    { roomId: room204._id, bedCode: '204-A', bedType: 'electric', status: 'available', condition: 'good' },
  ]);

  console.log('Creating residents...');
  const [res1, res2, res3, res4, res5, res6] = await Resident.insertMany([
    {
      residentCode: 'RES001',
      fullName: 'Cu Nguyen Thi D',
      dateOfBirth: new Date('1940-03-15'),
      gender: 'female',
      bloodType: 'A+',
      allergies: ['Penicillin', 'Sulfonamides'],
      chronicConditions: ['Type 2 Diabetes', 'Hypertension'],
      initialHealthCondition: 'Stable, requires daily medication monitoring',
      residencyStatus: 'admitted',
      admittedAt: new Date('2024-06-01'),
      roomId: room101._id,
      bedId: bed101A._id,
      familyPortalAccountIds: [family1._id],
    },
    {
      residentCode: 'RES002',
      fullName: 'Ong Tran Van E',
      dateOfBirth: new Date('1938-07-22'),
      gender: 'male',
      bloodType: 'B+',
      allergies: ['Aspirin', 'NSAIDs'],
      chronicConditions: ['Heart Failure', 'Atrial Fibrillation', 'CKD Stage 3'],
      initialHealthCondition: 'Requires close cardiac monitoring',
      residencyStatus: 'admitted',
      admittedAt: new Date('2024-08-10'),
      roomId: room102._id,
      bedId: bed102A._id,
      familyPortalAccountIds: [family2._id],
    },
    {
      residentCode: 'RES003',
      fullName: 'Ba Le Thi F',
      dateOfBirth: new Date('1942-11-05'),
      gender: 'female',
      bloodType: 'O+',
      allergies: [],
      chronicConditions: ['Hyperlipidemia', 'Osteoporosis'],
      initialHealthCondition: 'Good general condition, on cholesterol medication',
      residencyStatus: 'admitted',
      admittedAt: new Date('2024-09-15'),
      roomId: room103._id,
      bedId: bed103A._id,
      familyPortalAccountIds: [family3._id],
    },
    {
      residentCode: 'RES004',
      fullName: 'Cu Pham Van G',
      dateOfBirth: new Date('1935-04-18'),
      gender: 'male',
      bloodType: 'AB+',
      allergies: ['Codeine', 'Latex'],
      chronicConditions: ['Parkinsons Disease', 'Dementia', 'Hypertension'],
      initialHealthCondition: 'Requires full-time nursing care',
      residencyStatus: 'admitted',
      admittedAt: new Date('2024-05-20'),
      roomId: room201._id,
      bedId: bed201A._id,
      familyPortalAccountIds: [family4._id],
    },
    {
      residentCode: 'RES005',
      fullName: 'Ba Hoang Thi H',
      dateOfBirth: new Date('1945-09-30'),
      gender: 'female',
      bloodType: 'A-',
      allergies: ['Ibuprofen'],
      chronicConditions: ['Rheumatoid Arthritis', 'Type 2 Diabetes'],
      initialHealthCondition: 'Mobile with assistance, on immunosuppressants',
      residencyStatus: 'admitted',
      admittedAt: new Date('2024-11-01'),
      roomId: room202._id,
      bedId: bed202A._id,
      familyPortalAccountIds: [family5._id],
    },
    {
      residentCode: 'RES006',
      fullName: 'Cu Vo Van K',
      dateOfBirth: new Date('1932-12-10'),
      gender: 'male',
      bloodType: 'O-',
      allergies: ['Morphine'],
      chronicConditions: ['COPD', 'Type 2 Diabetes', 'Hypertension'],
      initialHealthCondition: 'Requires oxygen support and regular spirometry',
      residencyStatus: 'admitted',
      admittedAt: new Date('2025-01-15'),
      roomId: room203._id,
      bedId: bed203A._id,
      familyPortalAccountIds: [],
    },
  ]);

  await Bed.updateOne({ _id: bed101A._id }, { assignedResidentId: res1._id, assignedAt: new Date() });
  await Bed.updateOne({ _id: bed102A._id }, { assignedResidentId: res2._id, assignedAt: new Date() });
  await Bed.updateOne({ _id: bed103A._id }, { assignedResidentId: res3._id, assignedAt: new Date() });
  await Bed.updateOne({ _id: bed201A._id }, { assignedResidentId: res4._id, assignedAt: new Date() });
  await Bed.updateOne({ _id: bed202A._id }, { assignedResidentId: res5._id, assignedAt: new Date() });
  await Bed.updateOne({ _id: bed203A._id }, { assignedResidentId: res6._id, assignedAt: new Date() });

  console.log('Creating staff profiles...');
  const [, , , , nurseProfile1, nurseProfile2] = await StaffProfile.insertMany([
    { userId: admin._id, staffCode: 'ADM001', roleCategory: 'admin', specialty: 'Administration', assignedResidentIds: [] },
    { userId: manager._id, staffCode: 'MGR001', roleCategory: 'manager', specialty: 'Operations Management', assignedResidentIds: [] },
    { userId: doctor1._id, staffCode: 'DOC001', roleCategory: 'doctor', specialty: 'Internal Medicine', certifications: ['BLS', 'ACLS'], assignedResidentIds: [res1._id, res2._id, res3._id] },
    { userId: doctor2._id, staffCode: 'DOC002', roleCategory: 'doctor', specialty: 'General Medicine', certifications: ['BLS'], assignedResidentIds: [res4._id, res5._id, res6._id] },
    { userId: nurse1._id, staffCode: 'NUR001', roleCategory: 'nurse', specialty: 'Care Nursing', certifications: ['BLS', 'First Aid'], assignedResidentIds: [res1._id, res2._id, res3._id] },
    { userId: nurse2._id, staffCode: 'NUR002', roleCategory: 'nurse', specialty: 'Care Nursing', certifications: ['BLS'], assignedResidentIds: [res4._id, res5._id, res6._id] },
    { userId: caregiver1._id, staffCode: 'CAR001', roleCategory: 'caregiver', specialty: 'Daily Living Assistance', certifications: ['BLS', 'Elderly Care'], assignedResidentIds: [res1._id, res2._id, res3._id] },
    { userId: chef1._id, staffCode: 'CHE001', roleCategory: 'chef', specialty: 'Kitchen Management', certifications: ['Food Safety'], assignedResidentIds: [] },
    { userId: adminGmail._id, staffCode: 'ADM002', roleCategory: 'admin', specialty: 'Administration', assignedResidentIds: [] },
    { userId: doctorGmail._id, staffCode: 'DOC003', roleCategory: 'doctor', specialty: 'General Medicine', certifications: ['BLS'], assignedResidentIds: [] },
    { userId: nurseGmail._id, staffCode: 'NUR003', roleCategory: 'nurse', specialty: 'Care Nursing', certifications: ['BLS'], assignedResidentIds: [] },
    { userId: caregiverGmail._id, staffCode: 'CAR002', roleCategory: 'caregiver', specialty: 'Daily Living Assistance', certifications: ['BLS'], assignedResidentIds: [] },
  ]);

  let allAdminDocs = [];
  try {
    console.log('Creating prescriptions...');
    const prescriptionData = [
      { residentId: res1._id, doctorId: doctor1._id, medicationName: 'Metformin', dosage: '500mg', route: 'oral', scheduleTimes: ['07:00', '19:00'], notes: 'Take after meals. Monitor blood glucose.' },
      { residentId: res1._id, doctorId: doctor1._id, medicationName: 'Amlodipine', dosage: '5mg', route: 'oral', scheduleTimes: ['08:00'], notes: 'Monitor blood pressure weekly.' },
      { residentId: res2._id, doctorId: doctor1._id, medicationName: 'Bisoprolol', dosage: '5mg', route: 'oral', scheduleTimes: ['08:00'], notes: 'Do not stop abruptly. Monitor HR.' },
      { residentId: res2._id, doctorId: doctor1._id, medicationName: 'Warfarin', dosage: '2mg', route: 'oral', scheduleTimes: ['18:00'], notes: 'Check INR monthly. Risk of bleeding.' },
      { residentId: res3._id, doctorId: doctor1._id, medicationName: 'Atorvastatin', dosage: '20mg', route: 'oral', scheduleTimes: ['20:00'], notes: 'Take in the evening.' },
      { residentId: res4._id, doctorId: doctor2._id, medicationName: 'Levodopa Carbidopa', dosage: '100/25mg', route: 'oral', scheduleTimes: ['07:00', '13:00', '19:00'], notes: 'Do not take with high-protein meals.' },
      { residentId: res5._id, doctorId: doctor2._id, medicationName: 'Methotrexate', dosage: '10mg', route: 'oral', scheduleTimes: ['09:00'], notes: 'Weekly dose. Monitor LFTs monthly.' },
      { residentId: res6._id, doctorId: doctor2._id, medicationName: 'Tiotropium', dosage: '18mcg', route: 'inhaled', scheduleTimes: ['08:00'], notes: 'COPD maintenance.' },
    ];

    const prescriptions = [];
    for (const data of prescriptionData) {
      const { medicationName, dosage, route, scheduleTimes, notes, ...rest } = data;
      const prescriptionDate = daysAgo(5);
      const validUntil = daysAgo(-20);
      const p = await Prescription.create({
        ...rest,
        prescriptionDate,
        validUntil,
        status: 'ACTIVE',
        items: [
          {
            medicationName,
            dosage,
            frequency: scheduleTimes.length,
            times: scheduleTimes,
            route,
            startDate: prescriptionDate,
            endDate: validUntil,
            instructions: notes,
            isActive: true,
          },
        ],
      });
      p._scheduleTimes = scheduleTimes;
      prescriptions.push(p);
    }

    console.log('Creating medication administration records...');
    const nurseForResident = (resId) => {
      const key = String(resId);
      if ([res1, res2, res3].map((r) => String(r._id)).includes(key)) return nurseProfile1._id;
      return nurseProfile2._id;
    };

    for (const p of prescriptions) {
      const records = buildAdmins(p, p.residentId, nurseForResident(p.residentId), 14, 3);
      allAdminDocs.push(...records);
    }

    await MedicationAdministration.insertMany(allAdminDocs);
  } catch (err) {
    console.warn('Skipping prescription/admin seed due to model-level error:', err.message);
    allAdminDocs = [];
  }

  const { ensureDefaultShiftTemplates } = require('../services/defaultShiftBootstrap');
  await ensureDefaultShiftTemplates();

  console.log('Creating published rehabilitation schedules...');
  await seedRehabilitationSchedules(nurse1, [res1, res2, res3]);

  console.log('\n========================================');
  console.log('SEED DATA CREATED SUCCESSFULLY');
  console.log('========================================');
  console.log('\n--- Test accounts (password: password123) ---');
  console.log('Admin     : admin@test.com');
  console.log('Manager   : manager@test.com');
  console.log('Doctor1   : doctor@test.com');
  console.log('Doctor2   : doctor2@test.com');
  console.log('Nurse1    : nurse@test.com');
  console.log('Nurse2    : nurse2@test.com');
  console.log('Caregiver : caregiver@test.com');
  console.log('Chef      : chef@test.com');
  console.log('Family    : family@test.com');
  console.log('\n--- Additional login accounts (password: 12345678) ---');
  console.log('Admin Gmail    : admin@gmail.com');
  console.log('Doctor Gmail   : doctor@gmail.com');
  console.log('Nurse Gmail    : nurse@gmail.com');
  console.log('Caregiver Gmail: caregiver@gmail.com');
  console.log(`\nTotal residents: 6`);
  console.log(`Total administration records: ${allAdminDocs.length}`);
  console.log('========================================\n');

  await mongoose.disconnect();
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

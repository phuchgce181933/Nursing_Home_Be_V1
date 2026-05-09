require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/user');
const StaffProfile = require('../models/staffProfile');
const Resident = require('../models/resident');

const connectDB = require('../config/db');

const seed = async () => {
  await connectDB();

  console.log('Clearing old seed data...');
  await User.deleteMany({ email: { $in: ['admin@test.com', 'doctor@test.com', 'nurse@test.com', 'family@test.com'] } });
  await StaffProfile.deleteMany({ staffCode: { $in: ['DOC001', 'NUR001', 'ADM001'] } });
  await Resident.deleteMany({ residentCode: 'RES001' });

  const passwordHash = await bcrypt.hash('password123', 10);

  console.log('Creating users...');
  const admin = await User.create({
    fullName: 'Admin Test',
    email: 'admin@test.com',
    username: 'admin_test',
    passwordHash,
    role: 'admin',
    isActive: true,
  });

  const doctor = await User.create({
    fullName: 'Bác sĩ Nguyễn Văn A',
    email: 'doctor@test.com',
    username: 'doctor_test',
    passwordHash,
    role: 'doctor',
    isActive: true,
  });

  const nurse = await User.create({
    fullName: 'Điều dưỡng Trần Thị B',
    email: 'nurse@test.com',
    username: 'nurse_test',
    passwordHash,
    role: 'nurse',
    isActive: true,
  });

  const family = await User.create({
    fullName: 'Gia đình Lê Văn C',
    email: 'family@test.com',
    username: 'family_test',
    passwordHash,
    role: 'family',
    isActive: true,
  });

  console.log('Creating staff profiles...');
  const adminProfile = await StaffProfile.create({
    userId: admin._id,
    staffCode: 'ADM001',
    specialty: 'Administration',
    roleCategory: 'admin',
  });

  const doctorProfile = await StaffProfile.create({
    userId: doctor._id,
    staffCode: 'DOC001',
    specialty: 'General Medicine',
    roleCategory: 'doctor',
  });

  const nurseProfile = await StaffProfile.create({
    userId: nurse._id,
    staffCode: 'NUR001',
    specialty: 'Care Nursing',
    roleCategory: 'nurse',
  });

  console.log('Creating resident...');
  const resident = await Resident.create({
    residentCode: 'RES001',
    fullName: 'Cụ Nguyễn Thị D',
    dateOfBirth: new Date('1945-03-15'),
    gender: 'female',
    bloodType: 'A+',
    allergies: ['Penicillin'],
    chronicConditions: ['Tiểu đường', 'Huyết áp cao'],
    residencyStatus: 'admitted',
    admittedAt: new Date('2025-01-01'),
    familyPortalAccountIds: [family._id],
  });

  console.log('\n========================================');
  console.log('SEED DATA CREATED SUCCESSFULLY');
  console.log('========================================');
  console.log('\n--- Tài khoản test (password: password123) ---');
  console.log(`Admin   : admin@test.com`);
  console.log(`Doctor  : doctor@test.com`);
  console.log(`Nurse   : nurse@test.com`);
  console.log(`Family  : family@test.com`);
  console.log('\n--- IDs cần dùng khi test ---');
  console.log(`residentId    : ${resident._id}`);
  console.log(`doctorStaffId : ${doctorProfile._id}`);
  console.log(`nurseStaffId  : ${nurseProfile._id}`);
  console.log('========================================\n');

  await mongoose.disconnect();
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

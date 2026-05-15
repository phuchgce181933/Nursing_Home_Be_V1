// file này chỉ để nạp dữ liệu mẫu ban đầu vào database, không dùng để chạy server
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/user');
const StaffProfile = require('../models/staffProfile');
const Resident = require('../models/resident');
const connectDB = require('../config/db');

const SEED_EMAILS = [
  'admin@test.com',
  'manager@test.com',
  'doctor@test.com',
  'nurse@test.com',
  'family@test.com',
];
const SEED_STAFF_CODES = ['ADM001', 'MGR001', 'DOC001', 'NUR001'];

const seed = async () => {
  await connectDB();

  console.log('Clearing old seed data...');
  await User.deleteMany({ email: { $in: SEED_EMAILS } });
  await StaffProfile.deleteMany({ staffCode: { $in: SEED_STAFF_CODES } });
  await Resident.deleteMany({ residentCode: 'RES001' });

  const passwordHash = await bcrypt.hash('password123', 10);

  console.log('Creating users...');
  const [admin, manager, doctor, nurse, family] = await User.insertMany([
    {
      fullName: 'Admin Hệ Thống',
      email: 'admin@test.com',
      username: 'admin_test',
      passwordHash,
      role: 'admin',
      isActive: true,
    },
    {
      fullName: 'Quản Lý Nguyễn Văn B',
      email: 'manager@test.com',
      username: 'manager_test',
      passwordHash,
      role: 'manager',
      isActive: true,
    },
    {
      fullName: 'Bác sĩ Nguyễn Văn A',
      email: 'doctor@test.com',
      username: 'doctor_test',
      passwordHash,
      role: 'doctor',
      isActive: true,
    },
    {
      fullName: 'Điều dưỡng Trần Thị B',
      email: 'nurse@test.com',
      username: 'nurse_test',
      passwordHash,
      role: 'nurse',
      isActive: true,
    },
    {
      fullName: 'Gia đình Lê Văn C',
      email: 'family@test.com',
      username: 'family_test',
      passwordHash,
      role: 'family',
      isActive: true,
    },
  ]);

  console.log('Creating staff profiles...');
  const [, , doctorProfile, nurseProfile] = await StaffProfile.insertMany([
    { userId: admin._id,   staffCode: 'ADM001', roleCategory: 'admin',   specialty: 'Administration' },
    { userId: manager._id, staffCode: 'MGR001', roleCategory: 'manager', specialty: 'Operations Management' },
    { userId: doctor._id,  staffCode: 'DOC001', roleCategory: 'doctor',  specialty: 'General Medicine' },
    { userId: nurse._id,   staffCode: 'NUR001', roleCategory: 'nurse',   specialty: 'Care Nursing' },
  ]);

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
  console.log(`Manager : manager@test.com`);
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

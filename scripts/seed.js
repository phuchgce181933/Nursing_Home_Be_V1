// // Seed script — nạp dữ liệu mẫu.
// // Có 2 chế độ:
// //   force=false (startup auto-seed): upsert structural, bỏ qua content nếu đã có → data test FE không bị mất
// //   force=true  (npm run seed:local): xóa sạch rồi tạo lại toàn bộ
// require('dotenv').config();
// const mongoose = require('mongoose');
// const bcrypt   = require('bcryptjs');

// // ── Models ───────────────────────────────────────────────────────────────────
// const User                     = require('../models/user');
// const StaffProfile             = require('../models/staffProfile');
// const Resident                 = require('../models/resident');
// const Building                 = require('../models/building');
// const Floor                    = require('../models/floor');
// const Room                     = require('../models/room');
// const Bed                      = require('../models/bed');
// const ServicePackage           = require('../models/servicePackage');
// const Prescription             = require('../models/prescription');
// const MedicationAdministration = require('../models/medicationAdministration');
// const Shift                    = require('../models/shift');
// const ShiftTemplate            = require('../models/shiftTemplate');
// const CareNote                 = require('../models/careNote');
// const LeaveRequest             = require('../models/leaveRequest');
// const Incident                 = require('../models/incident');
// const Activity                 = require('../models/activity');
// const CareAppointment          = require('../models/careAppointment');
// const connectDB                = require('../config/db');

// const { ensureDefaultShiftTemplates } = require('../services/defaultShiftBootstrap');
// const { calcShiftDurationHours }      = require('../utils/shiftValidation');

// // ── Constants ─────────────────────────────────────────────────────────────────
// const SEED_BUILDING_CODE  = 'SEED_MAIN';
// const SEED_EMAILS = [
//   'admin@seed.com', 'manager@seed.com',
//   'doctor1@seed.com', 'doctor2@seed.com',
//   'nurse1@seed.com',  'nurse2@seed.com',
//   'pharmacist@seed.com', 'family1@seed.com',
// ];
// const SEED_STAFF_CODES    = ['ADM001', 'MGR001', 'DOC001', 'DOC002', 'NUR001', 'NUR002', 'PHA001'];
// const SEED_RESIDENT_CODES = ['RES001', 'RES002', 'RES003', 'RES004', 'RES005', 'RES006'];
// const SEED_PKG_CODES      = ['PKG-BASIC', 'PKG-STD', 'PKG-PREM', 'PKG-VIP'];

// // ── Helpers ───────────────────────────────────────────────────────────────────
// const daysAgo     = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0,0,0,0); return d; };
// const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(0,0,0,0); return d; };

// const atTime = (baseDate, hhmm) => {
//   const [h, m] = hhmm.split(':').map(Number);
//   const d = new Date(baseDate); d.setHours(h, m, 0, 0); return d;
// };

// const calcTotalHours = (s, e) => Math.round(calcShiftDurationHours(s, e) * 100) / 100;

// // Upsert: tạo mới nếu chưa có, cập nhật nếu đã có — _id được giữ nguyên
// const upsert = (Model, filter, data) =>
//   Model.findOneAndUpdate(filter, { $set: data }, { upsert: true, new: true, setDefaultsOnInsert: true });

// const buildAdmins = (prescription, residentId, staffId, daysBack, daysForward = 3) => {
//   const records = [];
//   const now = new Date();
//   const scheduleTimes = prescription.scheduleTimes ?? [];
//   for (let offset = -daysBack; offset <= daysForward; offset++) {
//     const base = new Date(now); base.setDate(now.getDate() + offset); base.setHours(0,0,0,0);
//     for (const time of scheduleTimes) {
//       const scheduledAt = atTime(base, time);
//       const isPast = scheduledAt < now; const isToday = offset === 0;
//       let status = 'pending', takenAt = null, administeredByStaffId = null, notes = '';
//       if (isPast && !isToday) {
//         const r = Math.random();
//         if (r < 0.75) { status = 'taken'; takenAt = new Date(scheduledAt.getTime() + (Math.floor(Math.random()*10)+1)*60000); administeredByStaffId = staffId; }
//         else if (r < 0.90) { status = 'missed'; notes = ['Bệnh nhân từ chối','Bệnh nhân đang ngủ','Thuốc tạm thời hết'][Math.floor(Math.random()*3)]; }
//         else status = 'overdue';
//       } else if (isToday && isPast) {
//         const r = Math.random();
//         if (r < 0.5) { status = 'taken'; takenAt = new Date(scheduledAt.getTime() + (Math.floor(Math.random()*15)+1)*60000); administeredByStaffId = staffId; }
//         else if (r < 0.7) status = 'overdue';
//       }
//       records.push({ prescriptionId: prescription._id, residentId, scheduledAt, status, takenAt: takenAt||undefined, administeredByStaffId: administeredByStaffId||undefined, notes });
//     }
//   }
//   return records;
// };

// // ── Cleanup (chỉ dùng khi force=true) ────────────────────────────────────────
// const cleanup = async () => {
//   console.log('🧹 Force cleanup: removing all seed data...');
//   const oldResidents = await Resident.find({ residentCode: { $in: SEED_RESIDENT_CODES } }, { _id: 1 });
//   const oldResidentIds = oldResidents.map(r => r._id);
//   const oldProfiles = await StaffProfile.find({ staffCode: { $in: SEED_STAFF_CODES } }, { _id: 1 });
//   const oldProfileIds = oldProfiles.map(p => p._id);
//   const oldUsers = await User.find({ email: { $in: SEED_EMAILS } }, { _id: 1 });
//   const oldUserIds = oldUsers.map(u => u._id);

//   // Khi force=true: xóa toàn bộ content data (kể cả orphan records cũ)
//   await CareNote.deleteMany({});
//   await Incident.deleteMany({});
//   await CareAppointment.deleteMany({});
//   if (oldResidentIds.length) {
//     await MedicationAdministration.deleteMany({ residentId: { $in: oldResidentIds } });
//     await Prescription.deleteMany({ residentId: { $in: oldResidentIds } });
//   }
//   if (oldProfileIds.length) {
//     await Shift.deleteMany({ assignedStaffId: { $in: oldProfileIds } });
//     await Activity.deleteMany({ organizerStaffId: { $in: oldProfileIds } });
//   }
//   if (oldUserIds.length) await LeaveRequest.deleteMany({ staffId: { $in: oldUserIds } });

//   const bld = await Building.findOne({ code: SEED_BUILDING_CODE });
//   if (bld) {
//     const floors = await Floor.find({ buildingId: bld._id }, { _id: 1 });
//     const fIds = floors.map(f => f._id);
//     const rooms = await Room.find({ floorId: { $in: fIds } }, { _id: 1 });
//     const rIds = rooms.map(r => r._id);
//     await Bed.deleteMany({ roomId: { $in: rIds } });
//     await Room.deleteMany({ _id: { $in: rIds } });
//     await Floor.deleteMany({ _id: { $in: fIds } });
//     await Building.deleteOne({ _id: bld._id });
//   }
//   await StaffProfile.deleteMany({ staffCode: { $in: SEED_STAFF_CODES } });
//   await Resident.deleteMany({ residentCode: { $in: SEED_RESIDENT_CODES } });
//   await User.deleteMany({ email: { $in: SEED_EMAILS } });
//   await ServicePackage.deleteMany({ packageCode: { $in: SEED_PKG_CODES } });
// };

// // ── Main seed ─────────────────────────────────────────────────────────────────
// const seed = async ({ force = false } = {}) => {
//   await connectDB();
//   if (force) await cleanup();

//   const pw = await bcrypt.hash('Password123!', 10);

//   // ── STRUCTURAL: luôn upsert — _id ổn định qua các lần restart ────────────

//   console.log('👤 Upserting users...');
//   const [admin, manager, doctor1, doctor2, nurse1, nurse2, pharmacist, family1] = await Promise.all([
//     upsert(User, { email: 'admin@seed.com' },      { fullName: 'Admin System',       username: 'admin_seed',   passwordHash: pw, role: 'admin',      isActive: true }),
//     upsert(User, { email: 'manager@seed.com' },    { fullName: 'Nguyễn Văn Bình',    username: 'manager_seed', passwordHash: pw, role: 'manager',    isActive: true }),
//     upsert(User, { email: 'doctor1@seed.com' },    { fullName: 'BS. Nguyễn Văn An',  username: 'doctor1_seed', passwordHash: pw, role: 'doctor',     phone: '0901000001', isActive: true }),
//     upsert(User, { email: 'doctor2@seed.com' },    { fullName: 'BS. Lê Văn Hùng',    username: 'doctor2_seed', passwordHash: pw, role: 'doctor',     phone: '0901000002', isActive: true }),
//     upsert(User, { email: 'nurse1@seed.com' },     { fullName: 'ĐD. Trần Thị Bích',  username: 'nurse1_seed',  passwordHash: pw, role: 'nurse',      phone: '0902000001', isActive: true }),
//     upsert(User, { email: 'nurse2@seed.com' },     { fullName: 'ĐD. Phạm Văn Cường', username: 'nurse2_seed',  passwordHash: pw, role: 'nurse',      phone: '0902000002', isActive: true }),
//     upsert(User, { email: 'pharmacist@seed.com' }, { fullName: 'DS. Hoàng Thị Lan',  username: 'pharma_seed',  passwordHash: pw, role: 'pharmacist', phone: '0903000001', isActive: true }),
//     upsert(User, { email: 'family1@seed.com' },    { fullName: 'Gia đình Nguyễn',    username: 'family1_seed', passwordHash: pw, role: 'family',     isActive: true }),
//   ]);

//   console.log('🏢 Upserting facility...');
//   const building = await upsert(Building, { code: SEED_BUILDING_CODE }, { name: 'Tòa điều dưỡng chính', address: '123 Đường Y Tế, Quận 1, TP.HCM', isActive: true });
//   const [floor1, floor2] = await Promise.all([
//     upsert(Floor, { buildingId: building._id, floorNumber: 1 }, { name: 'Tầng 1', description: 'Khu điều dưỡng cơ bản', isActive: true }),
//     upsert(Floor, { buildingId: building._id, floorNumber: 2 }, { name: 'Tầng 2', description: 'Khu điều dưỡng cao cấp', isActive: true }),
//   ]);
//   const [room101, room102, room201, room202] = await Promise.all([
//     upsert(Room, { floorId: floor1._id, roomNumber: '101' }, { buildingId: building._id, roomType: 'standard', capacity: 2, occupiedCount: 2, status: 'full' }),
//     upsert(Room, { floorId: floor1._id, roomNumber: '102' }, { buildingId: building._id, roomType: 'standard', capacity: 2, occupiedCount: 2, status: 'full' }),
//     upsert(Room, { floorId: floor2._id, roomNumber: '201' }, { buildingId: building._id, roomType: 'premium',  capacity: 2, occupiedCount: 1, status: 'available' }),
//     upsert(Room, { floorId: floor2._id, roomNumber: '202' }, { buildingId: building._id, roomType: 'premium',  capacity: 2, occupiedCount: 1, status: 'available' }),
//   ]);
//   const [bed101A, bed101B, bed102A, bed102B, bed201A, , bed202A] = await Promise.all([
//     upsert(Bed, { roomId: room101._id, bedCode: '101-A' }, { bedType: 'normal',   status: 'occupied',  condition: 'good' }),
//     upsert(Bed, { roomId: room101._id, bedCode: '101-B' }, { bedType: 'normal',   status: 'occupied',  condition: 'good' }),
//     upsert(Bed, { roomId: room102._id, bedCode: '102-A' }, { bedType: 'electric', status: 'occupied',  condition: 'good' }),
//     upsert(Bed, { roomId: room102._id, bedCode: '102-B' }, { bedType: 'electric', status: 'occupied',  condition: 'fair' }),
//     upsert(Bed, { roomId: room201._id, bedCode: '201-A' }, { bedType: 'normal',   status: 'occupied',  condition: 'good' }),
//     upsert(Bed, { roomId: room201._id, bedCode: '201-B' }, { bedType: 'normal',   status: 'available', condition: 'good' }),
//     upsert(Bed, { roomId: room202._id, bedCode: '202-A' }, { bedType: 'electric', status: 'occupied',  condition: 'good' }),
//     upsert(Bed, { roomId: room202._id, bedCode: '202-B' }, { bedType: 'normal',   status: 'available', condition: 'good' }),
//   ]);

//   console.log('👴 Upserting residents...');
//   const [res1, res2, res3, res4, res5, res6] = await Promise.all([
//     upsert(Resident, { residentCode: 'RES001' }, { fullName: 'Cụ Nguyễn Thị Dung',  dateOfBirth: new Date('1940-03-15'), gender: 'female', bloodType: 'A+',  allergies: ['Penicillin'],  drugAllergies: ['Sulfonamides'], chronicConditions: ['Tiểu đường type 2','Tăng huyết áp'],                 initialHealthCondition: 'Ổn định, cần theo dõi dùng thuốc hàng ngày',        bedId: bed101A._id, roomId: room101._id, residencyStatus: 'admitted', admittedAt: new Date('2024-06-01'), familyPortalAccountIds: [family1._id], emergencyContacts: [{ fullName: 'Nguyễn Văn Tú',  relationship: 'Con trai', phone: '0911111111', isPrimary: true }] }),
//     upsert(Resident, { residentCode: 'RES002' }, { fullName: 'Ông Trần Văn Em',      dateOfBirth: new Date('1938-07-22'), gender: 'male',   bloodType: 'B+',  allergies: ['Aspirin'],     drugAllergies: ['NSAIDs'],       chronicConditions: ['Suy tim','Rung nhĩ','Bệnh thận mạn giai đoạn 3'],    initialHealthCondition: 'Cần theo dõi tim mạch chặt chẽ',                    bedId: bed101B._id, roomId: room101._id, residencyStatus: 'admitted', admittedAt: new Date('2024-08-10'), familyPortalAccountIds: [],           emergencyContacts: [{ fullName: 'Trần Thị Hoa',   relationship: 'Con gái', phone: '0922222222', isPrimary: true }] }),
//     upsert(Resident, { residentCode: 'RES003' }, { fullName: 'Bà Lê Thị Phương',     dateOfBirth: new Date('1942-11-05'), gender: 'female', bloodType: 'O+',  allergies: [],              drugAllergies: [],               chronicConditions: ['Rối loạn lipid máu','Loãng xương'],                   initialHealthCondition: 'Tình trạng chung tốt, đang dùng thuốc mỡ máu',     bedId: bed102A._id, roomId: room102._id, residencyStatus: 'admitted', admittedAt: new Date('2024-09-15'), familyPortalAccountIds: [],           emergencyContacts: [{ fullName: 'Lê Thanh Hải',   relationship: 'Con trai', phone: '0933333333', isPrimary: true }] }),
//     upsert(Resident, { residentCode: 'RES004' }, { fullName: 'Cụ Phạm Văn Giang',    dateOfBirth: new Date('1935-04-18'), gender: 'male',   bloodType: 'AB+', allergies: ['Codeine'],     drugAllergies: ['Latex'],        chronicConditions: ['Bệnh Parkinson','Sa trí tuệ','Tăng huyết áp'],        initialHealthCondition: 'Cần chăm sóc toàn thời gian',                      bedId: bed102B._id, roomId: room102._id, residencyStatus: 'admitted', admittedAt: new Date('2024-05-20'), familyPortalAccountIds: [],           emergencyContacts: [{ fullName: 'Phạm Minh Tuấn', relationship: 'Con trai', phone: '0944444444', isPrimary: true }] }),
//     upsert(Resident, { residentCode: 'RES005' }, { fullName: 'Bà Hoàng Thị Hương',   dateOfBirth: new Date('1945-09-30'), gender: 'female', bloodType: 'A-',  allergies: ['Ibuprofen'],   drugAllergies: [],               chronicConditions: ['Viêm khớp dạng thấp','Tiểu đường type 2'],            initialHealthCondition: 'Di chuyển với hỗ trợ, đang dùng thuốc ức chế miễn dịch', bedId: bed201A._id, roomId: room201._id, residencyStatus: 'admitted', admittedAt: new Date('2024-11-01'), familyPortalAccountIds: [],           emergencyContacts: [{ fullName: 'Hoàng Văn Nam',  relationship: 'Con trai', phone: '0955555555', isPrimary: true }] }),
//     upsert(Resident, { residentCode: 'RES006' }, { fullName: 'Cụ Võ Văn Khoa',       dateOfBirth: new Date('1932-12-10'), gender: 'male',   bloodType: 'O-',  allergies: ['Morphine'],    drugAllergies: [],               chronicConditions: ['COPD','Tiểu đường type 2','Tăng huyết áp'],           initialHealthCondition: 'Cần hỗ trợ oxy và đo hô hấp ký định kỳ',          bedId: bed202A._id, roomId: room202._id, residencyStatus: 'admitted', admittedAt: new Date('2025-01-15'), familyPortalAccountIds: [],           emergencyContacts: [{ fullName: 'Võ Thị Lan',     relationship: 'Con gái', phone: '0966666666', isPrimary: true }] }),
//   ]);

//   console.log('👩‍⚕️ Upserting staff profiles...');
//   const [, , doctorProfile1, doctorProfile2, nurseProfile1, nurseProfile2] = await Promise.all([
//     upsert(StaffProfile, { staffCode: 'ADM001' }, { userId: admin._id,      roleCategory: 'admin',      specialty: 'Quản trị hệ thống',   assignedResidentIds: [] }),
//     upsert(StaffProfile, { staffCode: 'MGR001' }, { userId: manager._id,    roleCategory: 'manager',    specialty: 'Quản lý vận hành',    assignedResidentIds: [] }),
//     upsert(StaffProfile, { staffCode: 'DOC001' }, { userId: doctor1._id,    roleCategory: 'doctor',     specialty: 'Nội khoa tổng quát',  certifications: ['BLS','ACLS'],      responsibleAreaIds: [floor1._id], assignedResidentIds: [res1._id,res2._id,res3._id] }),
//     upsert(StaffProfile, { staffCode: 'DOC002' }, { userId: doctor2._id,    roleCategory: 'doctor',     specialty: 'Y học gia đình',       certifications: ['BLS'],             responsibleAreaIds: [floor2._id], assignedResidentIds: [res4._id,res5._id,res6._id] }),
//     upsert(StaffProfile, { staffCode: 'NUR001' }, { userId: nurse1._id,     roleCategory: 'nurse',      specialty: 'Điều dưỡng chăm sóc', certifications: ['BLS','First Aid'], responsibleAreaIds: [floor1._id], assignedResidentIds: [res1._id,res2._id,res3._id] }),
//     upsert(StaffProfile, { staffCode: 'NUR002' }, { userId: nurse2._id,     roleCategory: 'nurse',      specialty: 'Điều dưỡng chăm sóc', certifications: ['BLS'],             responsibleAreaIds: [floor2._id], assignedResidentIds: [res4._id,res5._id,res6._id] }),
//     upsert(StaffProfile, { staffCode: 'PHA001' }, { userId: pharmacist._id, roleCategory: 'pharmacist', specialty: 'Dược lâm sàng',        certifications: ['CPE'],             assignedResidentIds: [] }),
//   ]);

//   await Promise.all([
//     upsert(ServicePackage, { packageCode: 'PKG-BASIC' }, { name: 'Gói Cơ Bản',    tier: 'basic',    services: ['Bữa ăn 3 lần/ngày','Vệ sinh cá nhân','Theo dõi sức khỏe cơ bản'],                                        monthlyPrice: 8000000,  isActive: true, createdBy: admin._id }),
//     upsert(ServicePackage, { packageCode: 'PKG-STD'   }, { name: 'Gói Tiêu Chuẩn', tier: 'standard', services: ['Tất cả dịch vụ cơ bản','Khám bác sĩ 2 lần/tháng','Vật lý trị liệu','Hoạt động giải trí'],              monthlyPrice: 15000000, isActive: true, createdBy: admin._id }),
//     upsert(ServicePackage, { packageCode: 'PKG-PREM'  }, { name: 'Gói Cao Cấp',    tier: 'premium',  services: ['Tất cả dịch vụ tiêu chuẩn','Phòng riêng','Khám bác sĩ hàng tuần','Tư vấn dinh dưỡng','Giặt ủi'],      monthlyPrice: 25000000, isActive: true, createdBy: admin._id }),
//     upsert(ServicePackage, { packageCode: 'PKG-VIP'   }, { name: 'Gói VIP',         tier: 'vip',      services: ['Tất cả dịch vụ cao cấp','Y tá riêng 24/7','Khám bác sĩ theo yêu cầu','Xe đưa đón','Phòng suite'],      monthlyPrice: 45000000, isActive: true, createdBy: admin._id }),
//   ]);

//   await ensureDefaultShiftTemplates();
//   const [tmplDawn, tmplDay, tmplEvening] = await Promise.all([
//     ShiftTemplate.findOne({ shiftCode: 'DAWN' }),
//     ShiftTemplate.findOne({ shiftCode: 'DAY' }),
//     ShiftTemplate.findOne({ shiftCode: 'EVENING' }),
//   ]);

//   // ── CONTENT: chỉ tạo nếu chưa có — data tạo từ FE sẽ không bị xóa ────────

//   const residentIds    = [res1._id, res2._id, res3._id, res4._id, res5._id, res6._id];
//   const seedProfileIds = [doctorProfile1._id, doctorProfile2._id, nurseProfile1._id, nurseProfile2._id];
//   const seedUserIds    = [nurse1._id, nurse2._id, doctor2._id];
//   const nurseFor = (resId) => [res1,res2,res3].some(r => String(r._id) === String(resId)) ? nurseProfile1._id : nurseProfile2._id;

//   // Prescriptions + Med Admins
//   const rxCount = await Prescription.countDocuments({ residentId: { $in: residentIds } });
//   if (force || rxCount === 0) {
//     console.log('💊 Seeding prescriptions & administrations...');
//     // Schema cũ: prescribedByStaffId (StaffProfile), flat fields, status lowercase
//     const rxData = [
//       { residentId: res1._id, prescribedByStaffId: doctorProfile1._id, medicationName: 'Metformin',           dosage: '500mg',       route: 'Oral',       frequency: 'Hai lần/ngày',          scheduleTimes: ['07:00','19:00'],        startDate: daysAgo(14), status: 'active', notes: 'Uống sau bữa ăn. Theo dõi đường huyết.' },
//       { residentId: res1._id, prescribedByStaffId: doctorProfile1._id, medicationName: 'Amlodipine',          dosage: '5mg',         route: 'Oral',       frequency: 'Một lần/ngày',           scheduleTimes: ['08:00'],                startDate: daysAgo(14), status: 'active', notes: 'Theo dõi huyết áp hàng tuần.' },
//       { residentId: res2._id, prescribedByStaffId: doctorProfile1._id, medicationName: 'Bisoprolol',          dosage: '5mg',         route: 'Oral',       frequency: 'Một lần/ngày',           scheduleTimes: ['08:00'],                startDate: daysAgo(14), status: 'active', notes: 'Không ngừng thuốc đột ngột. Theo dõi nhịp tim.' },
//       { residentId: res2._id, prescribedByStaffId: doctorProfile1._id, medicationName: 'Furosemide',          dosage: '40mg',        route: 'Oral',       frequency: 'Một lần/ngày (sáng)',    scheduleTimes: ['07:30'],                startDate: daysAgo(14), status: 'active', notes: 'Theo dõi cân bằng dịch và kali máu.' },
//       { residentId: res2._id, prescribedByStaffId: doctorProfile1._id, medicationName: 'Warfarin',            dosage: '2mg',         route: 'Oral',       frequency: 'Một lần/ngày',           scheduleTimes: ['18:00'],                startDate: daysAgo(14), status: 'active', notes: 'Kiểm tra INR hàng tháng. Nguy cơ chảy máu.' },
//       { residentId: res3._id, prescribedByStaffId: doctorProfile1._id, medicationName: 'Atorvastatin',        dosage: '20mg',        route: 'Oral',       frequency: 'Một lần/ngày (tối)',     scheduleTimes: ['20:00'],                startDate: daysAgo(14), status: 'active', notes: 'Uống vào buổi tối.' },
//       { residentId: res3._id, prescribedByStaffId: doctorProfile1._id, medicationName: 'Calcium + Vit D3',    dosage: '600mg/400IU', route: 'Oral',       frequency: 'Hai lần/ngày',           scheduleTimes: ['09:00','21:00'],        startDate: daysAgo(14), status: 'active', notes: 'Uống kèm bữa ăn.' },
//       { residentId: res4._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Levodopa/Carbidopa',  dosage: '100/25mg',    route: 'Oral',       frequency: 'Ba lần/ngày',            scheduleTimes: ['07:00','13:00','19:00'],startDate: daysAgo(14), status: 'active', notes: 'Không uống cùng bữa ăn giàu đạm.' },
//       { residentId: res4._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Rivastigmine',        dosage: '3mg',         route: 'Oral',       frequency: 'Hai lần/ngày',           scheduleTimes: ['08:00','20:00'],        startDate: daysAgo(14), status: 'active', notes: 'Uống kèm bữa ăn. Theo dõi buồn nôn.' },
//       { residentId: res4._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Lisinopril',          dosage: '5mg',         route: 'Oral',       frequency: 'Một lần/ngày',           scheduleTimes: ['09:00'],                startDate: daysAgo(14), status: 'paused', notes: 'Tạm ngưng: HA quá thấp tuần này.' },
//       { residentId: res5._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Methotrexate',        dosage: '10mg',        route: 'Oral',       frequency: 'Một lần/tuần (Thứ Hai)', scheduleTimes: ['09:00'],                startDate: daysAgo(14), status: 'active', notes: 'Uống 1 lần/tuần vào thứ Hai. Theo dõi men gan.' },
//       { residentId: res5._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Folic Acid',          dosage: '5mg',         route: 'Oral',       frequency: 'Một lần/ngày',           scheduleTimes: ['08:00'],                startDate: daysAgo(14), status: 'active', notes: 'Uống hàng ngày, trừ ngày dùng Methotrexate.' },
//       { residentId: res5._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Glipizide',           dosage: '5mg',         route: 'Oral',       frequency: 'Hai lần/ngày',           scheduleTimes: ['07:00','18:00'],        startDate: daysAgo(14), status: 'active', notes: 'Uống 30 phút trước bữa ăn.' },
//       { residentId: res6._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Tiotropium',          dosage: '18mcg',       route: 'Inhalation', frequency: 'Một lần/ngày',           scheduleTimes: ['08:00'],                startDate: daysAgo(14), status: 'active', notes: 'COPD duy trì. Hướng dẫn kỹ thuật hít đúng cách.' },
//       { residentId: res6._id, prescribedByStaffId: doctorProfile2._id, medicationName: 'Salbutamol',          dosage: '100mcg/puff', route: 'Inhalation', frequency: 'Hai lần/ngày (khi cần)',  scheduleTimes: ['08:00','20:00'],        startDate: daysAgo(14), status: 'active', notes: 'Thuốc cấp cứu. Tối đa 4 nhát/4 giờ.' },
//     ];
//     const prescriptions = await Prescription.insertMany(rxData);
//     const allAdmins = [];
//     for (const p of prescriptions) allAdmins.push(...buildAdmins(p, p.residentId, nurseFor(p.residentId), 14, 3));
//     await MedicationAdministration.insertMany(allAdmins);
//     console.log(`   ✓ ${prescriptions.length} prescriptions, ${allAdmins.length} admin records`);
//   } else {
//     console.log(`   ℹ️  Prescriptions skipped (${rxCount} exist — preserving FE test data)`);
//   }

//   // Shifts
//   const shiftCount = await Shift.countDocuments({ assignedStaffId: { $in: seedProfileIds } });
//   if (force || shiftCount === 0) {
//     console.log('🗓️  Seeding shifts...');
//     const defs = [
//       { tmpl: tmplDawn,    startTime: '00:00', endTime: '08:00' },
//       { tmpl: tmplDay,     startTime: '08:00', endTime: '16:00' },
//       { tmpl: tmplEvening, startTime: '16:00', endTime: '00:00' },
//     ];
//     const shiftDocs = [];
//     for (let offset = -7; offset <= 7; offset++) {
//       const workDate = new Date(); workDate.setDate(workDate.getDate() + offset); workDate.setHours(0,0,0,0);
//       const status = offset < 0 ? 'completed' : offset === 0 ? 'confirmed' : 'published';
//       const ni = ((offset + 7) % 3 + 3) % 3;
//       const dayDef = defs[1];
//       for (const [staffId, floorId, def] of [
//         [nurseProfile1._id,  floor1._id, defs[ni]],
//         [nurseProfile2._id,  floor2._id, defs[ni]],
//         [doctorProfile1._id, floor1._id, dayDef],
//         [doctorProfile2._id, floor2._id, dayDef],
//       ]) shiftDocs.push({ name: def.tmpl.name, startTime: def.startTime, endTime: def.endTime, totalHours: calcTotalHours(def.startTime, def.endTime), workDate, assignedStaffId: staffId, floorId, shiftTemplateId: def.tmpl._id, status });
//     }
//     await Shift.insertMany(shiftDocs);
//     console.log(`   ✓ ${shiftDocs.length} shifts`);
//   } else {
//     console.log(`   ℹ️  Shifts skipped (${shiftCount} exist — preserving FE test data)`);
//   }

//   // Care Notes
//   const noteCount = await CareNote.countDocuments({ residentId: { $in: residentIds } });
//   if (force || noteCount === 0) {
//     console.log('📝 Seeding care notes...');
//     const n = (res, nurse, noteType, content, noteAt, metadata) =>
//       ({ residentId: res._id, authorStaffId: nurse._id, noteType, content, noteAt, metadata });

//     const notesDocs = [
//       // RES001 — Tiểu đường type 2, Tăng huyết áp
//       n(res1, nurseProfile1, 'meal',     'Cụ ăn bữa sáng đầy đủ, uống thuốc tiểu đường đúng giờ. Không có biểu hiện khó nuốt.',      daysAgo(1), { mealType: 'breakfast', intakeAmount: 'all',  appetite: 'good' }),
//       n(res1, nurseProfile1, 'activity', 'Cụ tham gia yoga nhẹ buổi sáng, thực hiện tốt các động tác kéo giãn. Tâm trạng vui vẻ.',   daysAgo(2), { activityType: 'exercise',       duration: 30, participationLevel: 'independent', mood: 'happy' }),
//       n(res1, nurseProfile1, 'health',   'HA 128/82 mmHg, nhịp tim 76/phút, đường huyết trước ăn 5.8 mmol/L. Tình trạng ổn định.',    daysAgo(1), { symptoms: [], consciousness: 'alert', fallRisk: 'low',    skinCondition: 'Bình thường', observations: 'Đường huyết kiểm soát tốt' }),
//       n(res1, nurseProfile1, 'general',  'Con cháu gọi điện thăm hỏi, cụ tinh thần tốt, đọc sách buổi chiều.',                         daysAgo(3), {}),

//       // RES002 — Suy tim, Rung nhĩ, CKD
//       n(res2, nurseProfile1, 'meal',     'Cụ ăn ít hơn thường lệ, chỉ ăn khoảng 50% bữa trưa. Ghi nhận theo dõi cân bằng dịch.',     daysAgo(1), { mealType: 'lunch',  intakeAmount: 'half', appetite: 'fair' }),
//       n(res2, nurseProfile1, 'activity', 'Cụ tham gia liệu pháp âm nhạc nhóm, vui vẻ nhưng cần nghỉ giữa giờ 5 phút do mệt.',         daysAgo(2), { activityType: 'socializing',    duration: 45, participationLevel: 'assisted',    mood: 'neutral' }),
//       n(res2, nurseProfile1, 'health',   'HA 145/92 mmHg, nhịp tim không đều 68–88/phút. Đã báo cáo bác sĩ trực. SpO2 96%.',           daysAgo(1), { symptoms: ['mệt mỏi nhẹ'], consciousness: 'alert', fallRisk: 'medium', skinCondition: 'Bình thường', observations: 'Nhịp tim không đều, cần theo dõi' }),
//       n(res2, nurseProfile1, 'general',  'Cụ ngủ trưa 2 tiếng, thức dậy khỏe khoắn, hỏi về kết quả xét nghiệm máu.',                  daysAgo(3), {}),

//       // RES003 — Rối loạn lipid, Loãng xương
//       n(res3, nurseProfile1, 'meal',     'Cụ ăn tốt, hoàn thành bữa chiều, uống đủ nước theo chỉ định của bác sĩ.',                   daysAgo(1), { mealType: 'dinner', intakeAmount: 'all',  appetite: 'excellent' }),
//       n(res3, nurseProfile1, 'activity', 'Cụ tham gia thủ công mỹ nghệ nhóm, làm hoa giấy, rất hứng thú và khéo léo.',                  daysAgo(2), { activityType: 'other',           duration: 60, participationLevel: 'independent', mood: 'happy' }),
//       n(res3, nurseProfile1, 'health',   'HA 122/78 mmHg, nhịp tim 72/phút, SpO2 98%. Không có triệu chứng đặc biệt.',                 daysAgo(1), { symptoms: [], consciousness: 'alert', fallRisk: 'low',    skinCondition: 'Bình thường', observations: 'Tình trạng tổng thể rất tốt' }),
//       n(res3, nurseProfile1, 'general',  'Con trai cụ ghé thăm buổi chiều, cụ trò chuyện sôi nổi, tâm trạng rất tốt.',                  daysAgo(3), {}),

//       // RES004 — Parkinson, Sa trí tuệ, Tăng huyết áp
//       n(res4, nurseProfile2, 'meal',     'Cụ cần hỗ trợ ăn do run tay. Ăn được khoảng 70% bữa sáng với thức ăn nghiền mềm.',           daysAgo(1), { mealType: 'breakfast', intakeAmount: 'most', appetite: 'fair' }),
//       n(res4, nurseProfile2, 'activity', 'Cụ tham gia vật lý trị liệu 30 phút, luyện dáng đi có hỗ trợ khung. Tiến triển đều đặn.',    daysAgo(2), { activityType: 'physiotherapy',  duration: 30, participationLevel: 'assisted',    mood: 'neutral' }),
//       n(res4, nurseProfile2, 'health',   'Run tay mức độ trung bình, dáng đi chậm với khung tập đi. HA 132/84 mmHg. SpO2 97%.',         daysAgo(1), { symptoms: ['run tay'], consciousness: 'alert', fallRisk: 'high',   skinCondition: 'Bình thường', observations: 'Triệu chứng Parkinson ổn định với phác đồ hiện tại' }),
//       n(res4, nurseProfile2, 'general',  'Cụ đang giai đoạn ổn định, không có biểu hiện kích động hoặc lú lẫn nặng trong ngày hôm nay.', daysAgo(3), {}),

//       // RES005 — Viêm khớp dạng thấp, Tiểu đường
//       n(res5, nurseProfile2, 'meal',     'Cụ ăn ngon miệng, bữa trưa hoàn thành, hỏi về thực đơn ít đường cho bữa tối.',               daysAgo(1), { mealType: 'lunch',  intakeAmount: 'all',  appetite: 'good' }),
//       n(res5, nurseProfile2, 'activity', 'Cụ tham gia tập kéo giãn nhẹ, báo đau nhẹ ở khớp ngón tay nhưng vẫn cố gắng hoàn thành.',    daysAgo(2), { activityType: 'exercise',       duration: 20, participationLevel: 'supervised',  mood: 'neutral' }),
//       n(res5, nurseProfile2, 'health',   'Khớp ngón tay sưng nhẹ, không nóng đỏ. Đường huyết sau ăn 7.4 mmol/L. Đang theo dõi.',       daysAgo(1), { symptoms: ['sưng khớp nhẹ'], consciousness: 'alert', fallRisk: 'medium', skinCondition: 'Bình thường', observations: 'Khớp ổn định, đường huyết cần theo dõi thêm' }),
//       n(res5, nurseProfile2, 'general',  'Cụ đọc báo sức khỏe, xem chương trình truyền hình, tinh thần khá tốt trong ngày.',             daysAgo(3), {}),

//       // RES006 — COPD, Tiểu đường, Tăng huyết áp
//       n(res6, nurseProfile2, 'meal',     'Cụ ăn ít do khó thở khi ăn. Bữa trưa 40%, uống đủ nước. Ăn theo nhiều bữa nhỏ.',             daysAgo(1), { mealType: 'lunch',  intakeAmount: 'little', appetite: 'poor' }),
//       n(res6, nurseProfile2, 'activity', 'Cụ tập thở có hướng dẫn 20 phút, kỹ thuật thở môi mím cải thiện so với tuần trước.',          daysAgo(2), { activityType: 'other',           duration: 20, participationLevel: 'supervised',  mood: 'neutral' }),
//       n(res6, nurseProfile2, 'health',   'SpO2 94% khi nghỉ, 91% khi hoạt động nhẹ — tăng lưu lượng oxy từ 2L lên 3L/phút.',           daysAgo(1), { symptoms: ['khó thở nhẹ'], consciousness: 'alert', fallRisk: 'medium', skinCondition: 'Bình thường', observations: 'SpO2 dưới ngưỡng khi gắng sức, đã điều chỉnh oxy' }),
//       n(res6, nurseProfile2, 'general',  'Cụ xem phim truyền hình, hỏi về lịch thăm của gia đình tuần tới.',                             daysAgo(3), {}),
//     ];
//     await CareNote.insertMany(notesDocs);
//     console.log(`   ✓ ${notesDocs.length} care notes`);
//   } else {
//     console.log(`   ℹ️  Care notes skipped (${noteCount} exist — preserving FE test data)`);
//   }

//   // Leave Requests
//   const leaveCount = await LeaveRequest.countDocuments({ staffId: { $in: seedUserIds } });
//   if (force || leaveCount === 0) {
//     console.log('🏖️  Seeding leave requests...');
//     await LeaveRequest.insertMany([
//       { staffId: nurse1._id,  type: 'annual',    startDate: daysAgo(20),   endDate: daysAgo(18),    reason: 'Nghỉ phép năm — về quê thăm gia đình',           status: 'approved', reviewedBy: manager._id, reviewedAt: daysAgo(22),  reviewNote: 'Đã duyệt. Bàn giao cho NUR002.', daysRequested: 3, replacementStaffProfileId: nurseProfile2._id },
//       { staffId: doctor2._id, type: 'sick',      startDate: daysFromNow(2), endDate: daysFromNow(4), reason: 'Bị cảm cúm, có giấy xác nhận của bác sĩ gia đình', status: 'pending', daysRequested: 3 },
//       { staffId: nurse2._id,  type: 'emergency', startDate: daysAgo(5),    endDate: daysAgo(4),     reason: 'Việc gia đình khẩn cấp',                          status: 'rejected', reviewedBy: manager._id, reviewedAt: daysAgo(6),   reviewNote: 'Không thể duyệt do thiếu nhân sự.', daysRequested: 2 },
//     ]);
//   } else { console.log(`   ℹ️  Leave requests skipped (${leaveCount} exist — preserving FE test data)`); }

//   // Incidents
//   const incidentCount = await Incident.countDocuments({ residentId: { $in: residentIds } });
//   if (force || incidentCount === 0) {
//     console.log('⚠️  Seeding incidents...');
//     await Incident.insertMany([
//       { residentId: res4._id, reportedByStaffId: nurseProfile2._id, reportedByUserId: nurse2._id, reporterName: 'ĐD. Phạm Văn Cường', reporterEmail: 'nurse2@seed.com', reporterRole: 'nurse', incidentType: 'Té ngã',         severity: 'high',     incidentAt: daysAgo(3),  location: 'Phòng 102-B', description: 'Cụ Phạm Văn Giang trượt chân lúc 3:15 sáng. Không chấn thương rõ. Đã kiểm tra và báo bác sĩ.', status: 'resolved',      assignedStaffIds: [nurseProfile2._id,doctorProfile2._id], notifiedManagement: true  },
//       { residentId: res2._id, reportedByStaffId: nurseProfile1._id, reportedByUserId: nurse1._id, reporterName: 'ĐD. Trần Thị Bích',  reporterEmail: 'nurse1@seed.com', reporterRole: 'nurse', incidentType: 'Phản ứng thuốc',  severity: 'medium',   incidentAt: daysAgo(7),  location: 'Phòng 101-B', description: 'Sau Warfarin, cụ xuất hiện vết bầm cánh tay. INR 3.8 vượt ngưỡng. Đã điều chỉnh liều.',        status: 'resolved',      assignedStaffIds: [doctorProfile1._id],                   notifiedManagement: false },
//       { residentId: res6._id, reportedByStaffId: nurseProfile2._id, reportedByUserId: nurse2._id, reporterName: 'ĐD. Phạm Văn Cường', reporterEmail: 'nurse2@seed.com', reporterRole: 'nurse', incidentType: 'Khó thở cấp',    severity: 'critical', incidentAt: daysAgo(1),  location: 'Phòng 202-A', description: 'SpO2 giảm xuống 88% lúc 2:30 sáng. Tăng oxy lên 5L/phút, gọi bác sĩ trực. Ổn sau 15 phút.',  status: 'investigating', assignedStaffIds: [doctorProfile2._id,nurseProfile2._id],  notifiedManagement: true  },
//       { residentId: res1._id, reportedByStaffId: nurseProfile1._id, reportedByUserId: nurse1._id, reporterName: 'ĐD. Trần Thị Bích',  reporterEmail: 'nurse1@seed.com', reporterRole: 'nurse', incidentType: 'Hạ đường huyết', severity: 'low',      incidentAt: daysAgo(10), location: 'Phòng 101-A', description: 'Đường huyết 3.2 mmol/L trước bữa tối. Cho uống nước đường, hồi phục sau 15 phút.',                   status: 'closed',        assignedStaffIds: [nurseProfile1._id],                    notifiedManagement: false },
//     ]);
//   } else { console.log(`   ℹ️  Incidents skipped (${incidentCount} exist — preserving FE test data)`); }

//   // Activities
//   const actCount = await Activity.countDocuments({ organizerStaffId: { $in: seedProfileIds } });
//   if (force || actCount === 0) {
//     console.log('🎯 Seeding activities...');
//     await Activity.insertMany([
//       { title: 'Tập thể dục buổi sáng',      category: 'Thể chất',  scheduledAt: daysAgo(2),    durationMinutes: 45,  location: 'Sân vườn tầng 1',        organizerStaffId: nurseProfile1._id,  participantResidentIds: [res1._id,res2._id,res3._id],                             status: 'completed',  participantResultNotes: 'Tất cả 3 cụ tham gia tích cực.' },
//       { title: 'Liệu pháp âm nhạc nhóm',     category: 'Tinh thần', scheduledAt: daysAgo(1),    durationMinutes: 60,  location: 'Phòng sinh hoạt tầng 1', organizerStaffId: nurseProfile1._id,  participantResidentIds: [res1._id,res2._id,res3._id,res4._id],                    status: 'completed',  participantResultNotes: 'Hoạt động vui vẻ. Cụ RES004 hát theo nhiều bài.' },
//       { title: 'Vật lý trị liệu — RES004',   category: 'Y tế',      scheduledAt: new Date(),    durationMinutes: 30,  location: 'Phòng trị liệu tầng 1',  organizerStaffId: doctorProfile1._id, participantResidentIds: [res4._id],                                               status: 'ongoing' },
//       { title: 'Bài tập thở — Nhóm hô hấp',  category: 'Y tế',      scheduledAt: daysFromNow(1), durationMinutes: 20, location: 'Phòng 202',              organizerStaffId: nurseProfile2._id,  participantResidentIds: [res6._id],                                               status: 'scheduled' },
//       { title: 'Khám sức khỏe định kỳ tháng', category: 'Y tế',     scheduledAt: daysFromNow(3), durationMinutes: 120, location: 'Phòng khám tầng 1',     organizerStaffId: doctorProfile1._id, participantResidentIds: [res1._id,res2._id,res3._id,res4._id,res5._id,res6._id], status: 'scheduled' },
//     ]);
//   } else { console.log(`   ℹ️  Activities skipped (${actCount} exist — preserving FE test data)`); }

//   // Care Appointments
//   const apptCount = await CareAppointment.countDocuments({ residentId: { $in: residentIds } });
//   if (force || apptCount === 0) {
//     console.log('📅 Seeding care appointments...');
//     const m = (n) => n * 60000;
//     await CareAppointment.insertMany([
//       { residentId: res1._id, doctorStaffId: doctorProfile1._id, nurseStaffId: nurseProfile1._id, scheduledStartAt: daysAgo(5),     scheduledEndAt: new Date(daysAgo(5).getTime()     + m(30)), appointmentType: 'Khám định kỳ tháng',            status: 'completed', notes: 'Đường huyết ổn định HbA1c 6.8%.' },
//       { residentId: res2._id, doctorStaffId: doctorProfile1._id, nurseStaffId: nurseProfile1._id, scheduledStartAt: daysAgo(3),     scheduledEndAt: new Date(daysAgo(3).getTime()     + m(45)), appointmentType: 'Theo dõi tim mạch',             status: 'completed', notes: 'INR 2.8 trong ngưỡng. Tiếp tục Warfarin 2mg.' },
//       { residentId: res4._id, doctorStaffId: doctorProfile2._id, nurseStaffId: nurseProfile2._id, scheduledStartAt: daysAgo(2),     scheduledEndAt: new Date(daysAgo(2).getTime()     + m(40)), appointmentType: 'Đánh giá thần kinh',            status: 'completed', notes: 'Parkinson ổn định. Tăng nhẹ Levodopa buổi tối.' },
//       { residentId: res3._id, doctorStaffId: doctorProfile1._id, nurseStaffId: nurseProfile1._id, scheduledStartAt: daysFromNow(2), scheduledEndAt: new Date(daysFromNow(2).getTime() + m(30)), appointmentType: 'Kiểm tra lipid máu',           status: 'scheduled', notes: 'Kiểm tra cholesterol và điều chỉnh Atorvastatin.' },
//       { residentId: res5._id, doctorStaffId: doctorProfile2._id, nurseStaffId: nurseProfile2._id, scheduledStartAt: daysFromNow(3), scheduledEndAt: new Date(daysFromNow(3).getTime() + m(45)), appointmentType: 'Theo dõi khớp và đường huyết', status: 'scheduled', notes: 'Đánh giá viêm khớp và hiệu quả Methotrexate.' },
//       { residentId: res6._id, doctorStaffId: doctorProfile2._id, nurseStaffId: nurseProfile2._id, scheduledStartAt: daysFromNow(1), scheduledEndAt: new Date(daysFromNow(1).getTime() + m(30)), appointmentType: 'Đánh giá hô hấp sau sự cố',   status: 'scheduled', notes: 'Theo dõi SpO2 và cân nhắc spirometry.' },
//     ]);
//   } else { console.log(`   ℹ️  Care appointments skipped (${apptCount} exist — preserving FE test data)`); }

//   console.log('\n========================================');
//   console.log(force ? '✅  SEED HOÀN TẤT (full reset)' : '✅  SEED HOÀN TẤT (additive)');
//   if (force) {
//     console.log('\n--- Tài khoản test (mật khẩu: Password123!) ---');
//     console.log('Admin      : admin@seed.com');
//     console.log('Manager    : manager@seed.com');
//     console.log('Doctor 1   : doctor1@seed.com   → RES001–003');
//     console.log('Doctor 2   : doctor2@seed.com   → RES004–006');
//     console.log('Nurse 1    : nurse1@seed.com    → RES001–003');
//     console.log('Nurse 2    : nurse2@seed.com    → RES004–006');
//     console.log('Pharmacist : pharmacist@seed.com');
//     console.log('Family     : family1@seed.com   → RES001');
//   }
//   console.log('========================================\n');
// };

// // Chạy standalone: npm run seed / npm run seed:local → force=true (full reset)
// if (require.main === module) {
//   seed({ force: true })
//     .then(() => mongoose.disconnect())
//     .catch((err) => { console.error('❌ Seed failed:', err); process.exit(1); });
// }

// module.exports = { seed };

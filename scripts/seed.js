// file này chỉ để nạp dữ liệu mẫu ban đầu vào database, không dùng để chạy server
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/user');
const StaffProfile = require('../models/staffProfile');
const Resident = require('../models/resident');
const Building = require('../models/building');
const Floor = require('../models/floor');
const Room = require('../models/room');
const Bed = require('../models/bed');
const connectDB = require('../config/db');

const bedsForRoom = (room) => [
  {
    roomId: room._id,
    bedCode: `${room.roomNumber}-1`,
    bedType: 'normal',
    status: 'available',
    condition: 'good',
  },
  {
    roomId: room._id,
    bedCode: `${room.roomNumber}-2`,
    bedType: 'normal',
    status: 'available',
    condition: 'good',
  },
];

const SEED_BUILDING_CODE = 'BLD001';
const SEED_EMAILS = [
  'admin@test.com',
  'manager@test.com',
  'doctor@test.com',
  'nurse@test.com',
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
const SEED_STAFF_CODES = ['ADM001', 'MGR001', 'DOC001', 'NUR001', 'ADM002', 'MGR002', 'DOC002'];
const SEED_RESIDENT_CODES = ['RES001', 'RES002', 'RES003', 'RES004', 'RES005'];

/**
 * Mẫu cư dân — thân nhân qua emergencyContacts + familyPortalAccountIds (User role family).
 * portalIds: { RES001: [ObjectId, ...], ... }
 */
const buildSeedResidents = (portalIds) => [
  {
    residentCode: 'RES001',
    fullName: 'Cụ Nguyễn Thị D',
    dateOfBirth: new Date('1945-03-15'),
    gender: 'female',
    citizenId: '024145001234',
    insuranceNumber: 'DN1450012345678',
    bloodType: 'A+',
    personalAddress: '45 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP.HCM',
    servicePackage: 'Premium Care',
    drugAllergies: ['Penicillin', 'Tôm càng'],
    chronicConditions: ['Tiểu đường type 2', 'Tăng huyết áp'],
    medicalHistory: ['Sốt xuất huyết (2010)'],
    initialHealthCondition:
      'Nhập viện tỉnh táo, ổn định; cần hỗ trợ đo đường huyết và huyết áp theo kế hoạch chăm sóc hàng ngày',
    familyPortalAccountIds: portalIds.RES001,
    emergencyContacts: [
      {
        fullName: 'Nguyễn Văn Con',
        relationship: 'Con trai',
        phone: '0912345678',
        email: 'con.nguyen@example.com',
        address: '123 Lê Lợi, Quận 1, TP.HCM',
        isPrimary: true,
      },
      {
        fullName: 'Trần Thị Lan',
        relationship: 'Con gái',
        phone: '0987654321',
        email: 'lan.tran@example.com',
        address: '56 Pasteur, Quận 3, TP.HCM',
        isPrimary: false,
      },
      {
        fullName: 'Nguyễn Minh An',
        relationship: 'Cháu nội',
        phone: '0909001122',
        email: 'an.nguyen@example.com',
        address: '123 Lê Lợi, Quận 1, TP.HCM',
        isPrimary: false,
      },
    ],
  },
  {
    residentCode: 'RES002',
    fullName: 'Ông Trần Văn E',
    dateOfBirth: new Date('1940-07-20'),
    gender: 'male',
    citizenId: '021940007890',
    insuranceNumber: 'DN9400078901234',
    bloodType: 'B+',
    personalAddress: '12 Trần Hưng Đạo, Phường 7, Quận 5, TP.HCM',
    servicePackage: 'Standard Plus',
    drugAllergies: ['Aspirin', 'Ibuprofen'],
    chronicConditions: ['Parkinson giai đoạn 2', 'Loãng xương'],
    medicalHistory: ['Gãy xương đùi (2018)'],
    initialHealthCondition:
      'Lúc nhập viện yếu, run tay chân; đi lại cần khung tập và hỗ trợ 1-1 khi di chuyển',
    familyPortalAccountIds: portalIds.RES002,
    emergencyContacts: [
      {
        fullName: 'Trần Thị Mai',
        relationship: 'Vợ',
        phone: '0903123456',
        email: 'mai.tran@example.com',
        address: '12 Trần Hưng Đạo, Phường 7, Quận 5, TP.HCM',
        isPrimary: true,
      },
      {
        fullName: 'Trần Văn Nam',
        relationship: 'Con trai',
        phone: '0903222333',
        email: 'nam.tran@example.com',
        address: '78 Nguyễn Trãi, Quận 5, TP.HCM',
        isPrimary: false,
      },
      {
        fullName: 'Trần Thị Hoa',
        relationship: 'Con gái',
        phone: '0903444555',
        email: 'hoa.tran@example.com',
        address: '22 Cộng Hòa, Tân Bình, TP.HCM',
        isPrimary: false,
      },
    ],
  },
  {
    residentCode: 'RES003',
    fullName: 'Bà Lê Thị F',
    dateOfBirth: new Date('1948-11-02'),
    gender: 'female',
    citizenId: '079148002345',
    insuranceNumber: 'DN1480023456789',
    bloodType: 'O+',
    personalAddress: '88 Võ Văn Tần, Phường 6, Quận 3, TP.HCM',
    servicePackage: 'Intensive Monitoring',
    drugAllergies: [],
    chronicConditions: ['Suy tim NYHA II', 'Hen phế quản'],
    medicalHistory: ['Viêm phổi nhẹ (2019)'],
    initialHealthCondition:
      'Nhập viện còn hoạt bát nhẹ; leo cầu thang hơi khó thở, cần theo dõi SpO2 khi gắng sức',
    familyPortalAccountIds: portalIds.RES003,
    emergencyContacts: [
      {
        fullName: 'Lê Minh Khôi',
        relationship: 'Con trai',
        phone: '0938765432',
        email: 'khoi.le@example.com',
        address: '88 Võ Văn Tần, Phường 6, Quận 3, TP.HCM',
        isPrimary: true,
      },
      {
        fullName: 'Lê Thị Hương',
        relationship: 'Con gái',
        phone: '0977123456',
        email: 'huong.le@example.com',
        address: '10 Đinh Tiên Hoàng, Quận 1, TP.HCM',
        isPrimary: false,
      },
      {
        fullName: 'Lê Văn Phúc',
        relationship: 'Chồng (đã mất)',
        phone: '02838291234',
        address: '88 Võ Văn Tần, Phường 6, Quận 3, TP.HCM',
        isPrimary: false,
      },
    ],
  },
  {
    residentCode: 'RES004',
    fullName: 'Cụ Phạm Văn G',
    dateOfBirth: new Date('1939-05-28'),
    gender: 'male',
    citizenId: '021939005678',
    insuranceNumber: 'DN9390056789012',
    bloodType: 'A-',
    personalAddress: '200 Lý Thường Kiệt, Phường 14, Quận 10, TP.HCM',
    servicePackage: 'Renal Care',
    drugAllergies: ['Hải sản', 'Đậu phộng'],
    chronicConditions: ['Suy thận mạn giai đoạn 3', 'Gout'],
    medicalHistory: ['Sỏi thận đã tán (2015)'],
    initialHealthCondition:
      'Khi nhập viện mệt, phù nhẹ chân buổi chiều; cần chế độ ăn hạn chế muối theo chỉ định',
    familyPortalAccountIds: portalIds.RES004,
    emergencyContacts: [
      {
        fullName: 'Phạm Thị Nga',
        relationship: 'Con gái',
        phone: '0919888777',
        email: 'nga.pham@example.com',
        address: '15 Cách Mạng Tháng 8, Quận 3, TP.HCM',
        isPrimary: true,
      },
      {
        fullName: 'Phạm Văn Tài',
        relationship: 'Con trai',
        phone: '0919777666',
        email: 'tai.pham@example.com',
        address: '200 Lý Thường Kiệt, Quận 10, TP.HCM',
        isPrimary: false,
      },
      {
        fullName: 'Phạm Thị Lan',
        relationship: 'Con dâu',
        phone: '0919666555',
        email: 'lan.pham@example.com',
        address: '200 Lý Thường Kiệt, Quận 10, TP.HCM',
        isPrimary: false,
      },
    ],
  },
  {
    residentCode: 'RES005',
    fullName: 'Bà Hoàng Thị H',
    dateOfBirth: new Date('1950-12-10'),
    gender: 'female',
    citizenId: '079150003456',
    insuranceNumber: 'DN1500034567890',
    bloodType: 'AB+',
    personalAddress: '33 Điện Biên Phủ, Phường 15, Quận Bình Thạnh, TP.HCM',
    servicePackage: 'Rehabilitation',
    drugAllergies: ['Thuốc cản quang iod'],
    chronicConditions: ['Rối loạn nhịp tim'],
    medicalHistory: ['Đột quỵ nhẹ (2023)', 'Hen phế quản thời thơ ấu'],
    initialHealthCondition:
      'Yếu nửa người phải khi nhập viện; cần chăm sóc 1-1 khi di chuyển và tập PHCN theo lịch',
    familyPortalAccountIds: portalIds.RES005,
    emergencyContacts: [
      {
        fullName: 'Hoàng Văn Đức',
        relationship: 'Con trai',
        phone: '0905111222',
        email: 'duc.hoang@example.com',
        address: '33 Điện Biên Phủ, Bình Thạnh, TP.HCM',
        isPrimary: true,
      },
      {
        fullName: 'Hoàng Thị Loan',
        relationship: 'Con dâu',
        phone: '0905333444',
        email: 'loan.hoang@example.com',
        address: '33 Điện Biên Phủ, Bình Thạnh, TP.HCM',
        isPrimary: false,
      },
      {
        fullName: 'Hoàng Văn Bình',
        relationship: 'Con trai',
        phone: '0905555666',
        email: 'binh.hoang@example.com',
        address: '120 Xô Viết Nghệ Tĩnh, Bình Thạnh, TP.HCM',
        isPrimary: false,
      },
    ],
  },
];

const shuffle = (items) => {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const assignResidentToBed = async (resident, bed, roomById, admittedAt) => {
  const room = roomById.get(bed.roomId.toString());

  await Resident.findByIdAndUpdate(resident._id, {
    roomId: bed.roomId,
    bedId: bed._id,
    residencyStatus: 'admitted',
    admittedAt,
  });

  await Bed.findByIdAndUpdate(bed._id, {
    status: 'occupied',
    assignedResidentId: resident._id,
    assignedAt: admittedAt,
  });

  const updatedRoom = await Room.findByIdAndUpdate(
    bed.roomId,
    { $inc: { occupiedCount: 1 } },
    { new: true }
  );

  if (updatedRoom.occupiedCount >= updatedRoom.capacity) {
    await Room.findByIdAndUpdate(bed.roomId, { status: 'full' });
  }

  return { resident, bed, room };
};

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

  const passwordHash = await bcrypt.hash('password123', 10);
  const gmailPasswordHash = await bcrypt.hash('12345678', 10);

  console.log('Creating users...');
  const [admin, manager, doctor, nurse, family1, family1b, family2, family3, family4, family5] =
    await User.insertMany([
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
        fullName: 'Nguyễn Văn Con',
        email: 'family@test.com',
        username: 'family_res001',
        phone: '0912345678',
        passwordHash,
        role: 'family',
        isActive: true,
        address: '123 Lê Lợi, Quận 1, TP.HCM',
      },
      {
        fullName: 'Trần Thị Lan',
        email: 'family1b@test.com',
        username: 'family_res001b',
        phone: '0987654321',
        passwordHash,
        role: 'family',
        isActive: true,
        address: '56 Pasteur, Quận 3, TP.HCM',
      },
      {
        fullName: 'Trần Thị Mai',
        email: 'family2@test.com',
        username: 'family_res002',
        phone: '0903123456',
        passwordHash,
        role: 'family',
        isActive: true,
        address: '12 Trần Hưng Đạo, Quận 5, TP.HCM',
      },
      {
        fullName: 'Lê Minh Khôi',
        email: 'family3@test.com',
        username: 'family_res003',
        phone: '0938765432',
        passwordHash,
        role: 'family',
        isActive: true,
        address: '88 Võ Văn Tần, Quận 3, TP.HCM',
      },
      {
        fullName: 'Phạm Thị Nga',
        email: 'family4@test.com',
        username: 'family_res004',
        phone: '0919888777',
        passwordHash,
        role: 'family',
        isActive: true,
        address: '15 Cách Mạng Tháng 8, Quận 3, TP.HCM',
      },
      {
        fullName: 'Hoàng Văn Đức',
        email: 'family5@test.com',
        username: 'family_res005',
        phone: '0905111222',
        passwordHash,
        role: 'family',
        isActive: true,
        address: '33 Điện Biên Phủ, Bình Thạnh, TP.HCM',
      },
    ]);

  const [adminGmail, managerGmail, doctorGmail] = await User.insertMany([
    {
      fullName: 'Admin Gmail',
      email: 'admin@gmail.com',
      username: 'admin_gmail',
      passwordHash: gmailPasswordHash,
      role: 'admin',
      isActive: true,
    },
    {
      fullName: 'Quản Lý Gmail',
      email: 'manager@gmail.com',
      username: 'manager_gmail',
      passwordHash: gmailPasswordHash,
      role: 'manager',
      isActive: true,
    },
    {
      fullName: 'Bác Sĩ Gmail',
      email: 'doctor@gmail.com',
      username: 'doctor_gmail',
      passwordHash: gmailPasswordHash,
      role: 'doctor',
      isActive: true,
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
      buildingId: building._id,
      floorNumber: 1,
      name: 'Tầng 1',
      description: 'Tầng điều dưỡng tầng trệt',
      isActive: true,
    },
    {
      buildingId: building._id,
      floorNumber: 2,
      name: 'Tầng 2',
      description: 'Tầng điều dưỡng tầng hai',
      isActive: true,
    },
  ]);

  const [room101, room102, room201, room202] = await Room.insertMany([
    {
      buildingId: building._id,
      floorId: floor1._id,
      roomNumber: '101',
      roomType: 'standard',
      capacity: 4,
      occupiedCount: 0,
      status: 'available',
    },
    {
      buildingId: building._id,
      floorId: floor1._id,
      roomNumber: '102',
      roomType: 'standard',
      capacity: 4,
      occupiedCount: 0,
      status: 'available',
    },
    {
      buildingId: building._id,
      floorId: floor2._id,
      roomNumber: '201',
      roomType: 'standard',
      capacity: 4,
      occupiedCount: 0,
      status: 'available',
    },
    {
      buildingId: building._id,
      floorId: floor2._id,
      roomNumber: '202',
      roomType: 'premium',
      capacity: 2,
      occupiedCount: 0,
      status: 'available',
    },
  ]);

  console.log('Creating beds (2 per room)...');
  const rooms = [room101, room102, room201, room202];
  const beds = await Bed.insertMany(rooms.flatMap(bedsForRoom));

  console.log('Creating sick residents and assigning to random beds...');
  const admittedAt = new Date('2025-01-01');
  const roomById = new Map(rooms.map((r) => [r._id.toString(), r]));
  const floorById = new Map([
    [floor1._id.toString(), floor1],
    [floor2._id.toString(), floor2],
  ]);

  const residents = await Resident.insertMany(buildSeedResidents(familyPortalIds));

  const shuffledBeds = shuffle(beds);
  const placements = [];
  for (let i = 0; i < residents.length; i += 1) {
    placements.push(
      await assignResidentToBed(residents[i], shuffledBeds[i], roomById, admittedAt)
    );
  }

  const [resident] = residents;

  console.log('\n========================================');
  console.log('SEED DATA CREATED SUCCESSFULLY');
  console.log('========================================');
  console.log('\n--- Tài khoản @test.com (password: password123) ---');
  console.log(`Admin   : admin@test.com`);
  console.log(`Manager : manager@test.com`);
  console.log(`Doctor  : doctor@test.com`);
  console.log(`Nurse   : nurse@test.com`);
  console.log('\n--- Tài khoản @gmail.com (password: 12345678) ---');
  console.log(`Admin   : admin@gmail.com`);
  console.log(`Manager : manager@gmail.com`);
  console.log(`Doctor  : doctor@gmail.com`);
  console.log(`Family RES001 (con):  family@test.com`);
  console.log(`Family RES001 (gái): family1b@test.com`);
  console.log(`Family RES002:       family2@test.com`);
  console.log(`Family RES003:       family3@test.com`);
  console.log(`Family RES004:       family4@test.com`);
  console.log(`Family RES005:       family5@test.com`);
  console.log('\n--- IDs cần dùng khi test ---');
  console.log(`buildingId    : ${building._id}`);
  console.log(`floor1Id      : ${floor1._id}  (Tầng 1)`);
  console.log(`floor2Id      : ${floor2._id}  (Tầng 2)`);
  console.log(`room101Id     : ${room101._id}`);
  console.log(`room102Id     : ${room102._id}`);
  console.log(`room201Id     : ${room201._id}`);
  console.log(`room202Id     : ${room202._id}`);
  console.log('\n--- Giường (bedCode → bedId) ---');
  beds.forEach((bed) => console.log(`${bed.bedCode.padEnd(8)}: ${bed._id}`));
  console.log(`\nresidentId (RES001): ${resident._id}`);
  console.log(`doctorStaffId     : ${doctorProfile._id}`);
  console.log(`nurseStaffId      : ${nurseProfile._id}`);
  console.log('\n--- Cư dân → phòng / tầng (gán ngẫu nhiên) ---');
  placements.forEach(({ resident: r, bed, room }) => {
    const floor = floorById.get(room.floorId.toString());
    const contacts = r.emergencyContacts?.length ?? 0;
    const portalCount = r.familyPortalAccountIds?.length ?? 0;
    console.log(
      `${r.residentCode} ${r.fullName} → phòng ${room.roomNumber}, tầng ${floor.floorNumber}, giường ${bed.bedCode} | thân nhân: ${contacts} | cổng GD: ${portalCount}`
    );
  });
  console.log('\n--- Thân nhân (emergencyContacts) — xem GET /api/residents/:id/family ---');
  residents.forEach((r) => {
    console.log(`\n${r.residentCode} — ${r.fullName}`);
    (r.emergencyContacts || []).forEach((c) => {
      const tag = c.isPrimary ? ' [chính]' : '';
      console.log(`  • ${c.relationship}: ${c.fullName} | ${c.phone} | ${c.email || '—'}${tag}`);
    });
  });
  console.log('========================================\n');

  await mongoose.disconnect();
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

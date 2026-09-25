// scripts/cleanupAppointmentAssignedResidents.js
//
// One-time cleanup for data that was contaminated by the old auto-add
// in admissionService.js (which pushed residentId into staff
// `assignedResidentIds` whenever a Care Appointment had that staff as
// doctor/nurse).
//
// Behavior:
//   - Default mode is DRY RUN: prints what would be removed, writes
//     nothing to MongoDB.
//   - Pass `--apply` to actually perform the cleanup.
//
// Logic:
//   For every (staff, resident) pair where the staff is doctorStaffId
//   or nurseStaffId on any non-cancelled Care Appointment for that
//   resident, remove that resident from staff.assignedResidentIds.
//
// Run from Nursing_Home_be:
//   node scripts/cleanupAppointmentAssignedResidents.js           # dry run
//   node scripts/cleanupAppointmentAssignedResidents.js --apply    # apply
//
// [DISABLED 2026-09-25] Bật lại để bỏ auto-add của admissionService.
require('dotenv').config();
const mongoose = require('mongoose');

const StaffProfile = require('../models/staffProfile');
const CareAppointment = require('../models/careAppointment');

const APPLY = process.argv.includes('--apply');

(async () => {
  if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
    console.error('Missing MONGODB_URI / MONGO_URI in .env');
    process.exit(1);
  }
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(uri);
  console.log(`[cleanup] Connected to MongoDB (mode=${APPLY ? 'APPLY' : 'DRY RUN'})`);

  // Lấy mọi appointment KHÔNG bị cancel, để lấy cặp (staff, resident).
  const appts = await CareAppointment.find(
    { status: { $ne: 'cancelled' } },
    { doctorStaffId: 1, nurseStaffId: 1, residentId: 1 }
  ).lean();

  // Build map: staffId -> Set(residentId)
  const pairsByStaff = new Map();
  for (const a of appts) {
    const rid = a.residentId ? String(a.residentId) : null;
    if (!rid) continue;
    for (const sid of [a.doctorStaffId, a.nurseStaffId]) {
      if (!sid) continue;
      const key = String(sid);
      if (!pairsByStaff.has(key)) pairsByStaff.set(key, new Set());
      pairsByStaff.get(key).add(rid);
    }
  }
  console.log(
    `[cleanup] Found ${pairsByStaff.size} staff profiles linked via Care Appointments.`
  );

  let totalStaffScanned = 0;
  let totalStaffAffected = 0;
  let totalResidentsRemoved = 0;

  for (const [staffId, residentSet] of pairsByStaff.entries()) {
    totalStaffScanned += 1;
    const profile = await StaffProfile.findById(staffId).lean();
    if (!profile) continue;
    const current = (profile.assignedResidentIds || []).map((id) => String(id));
    const next = current.filter((id) => !residentSet.has(id));
    const removed = current.length - next.length;
    if (removed === 0) continue;

    totalStaffAffected += 1;
    totalResidentsRemoved += removed;
    console.log(
      `  - staff ${staffId} (${profile.userId?.fullName || 'n/a'}):` +
        ` assignedResidentIds ${current.length} -> ${next.length}` +
        ` (removed ${removed})`
    );

    if (APPLY) {
      await StaffProfile.updateOne(
        { _id: staffId },
        { $set: { assignedResidentIds: next.map((id) => new mongoose.Types.ObjectId(id)) } }
      );
    }
  }

  console.log('---');
  console.log(`[cleanup] Scanned ${totalStaffScanned} staff profiles.`);
  console.log(`[cleanup] Affected (had at least one resident to remove): ${totalStaffAffected}`);
  console.log(`[cleanup] Total resident entries removed: ${totalResidentsRemoved}`);
  console.log(
    `[cleanup] Mode: ${APPLY ? 'APPLIED' : 'DRY RUN — re-run with --apply to commit.'}`
  );

  await mongoose.disconnect();
})().catch((err) => {
  console.error('[cleanup] Failed:', err);
  process.exit(1);
});

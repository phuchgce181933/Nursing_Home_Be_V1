const express = require('express');
const router = express.Router();
const User = require('../models/user');
const StaffProfile = require('../models/staffProfile');
const Resident = require('../models/resident');
const LeaveRequest = require('../models/leaveRequest');
const Shift = require('../models/shift');
const { protect, authorize } = require('../middleware/auth');

const resolveStaffProfile = async (id) => {
  if (!id) return null;
  const profileById = await StaffProfile.findById(id).lean();
  if (profileById) return profileById;
  return StaffProfile.findOne({ userId: id }).lean();
};

// GET /api/staff - list users with staff roles
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const q = { role: { $in: ['doctor','nurse','pharmacist','staff'] } };
    if (req.query.search) q.$or = [
      { fullName: { $regex: req.query.search, $options: 'i' } },
      { email: { $regex: req.query.search, $options: 'i' } },
    ];
    const users = await User.find(q).limit(500).lean();
    const profileMap = {};
    const userIds = users.map((u) => u._id);
    const profiles = await StaffProfile.find({ userId: { $in: userIds } }).lean();
    for (const p of profiles) profileMap[String(p.userId)] = p;
    const data = users.map((u) => ({ ...u, staffProfile: profileMap[String(u._id)] || null }));
    res.json({ data });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// GET /api/staff/:id/residents/available
router.get('/:id/residents/available', protect, async (req, res) => {
  try {
    const profile = await resolveStaffProfile(req.params.id);
    if (!profile) return res.status(404).json({ message: 'Staff profile not found' });

    const assignedIds = Array.isArray(profile.assignedResidentIds)
      ? profile.assignedResidentIds
      : [];

    const availableResidents = await Resident.find({
      _id: { $nin: assignedIds },
      residencyStatus: { $in: ['pending', 'admitted'] },
    })
      .limit(200)
      .lean();

    res.json({ data: availableResidents });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// GET /api/staff/:id/residents/assigned
router.get('/:id/residents/assigned', protect, async (req, res) => {
  try {
    const profile = await resolveStaffProfile(req.params.id);
    if (!profile) return res.status(404).json({ message: 'Staff profile not found' });

    const assignedIds = Array.isArray(profile.assignedResidentIds)
      ? profile.assignedResidentIds
      : [];

    const assignedResidents = await Resident.find({ _id: { $in: assignedIds } }).lean();
    res.json({ data: assignedResidents });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// GET /api/staff/availability
router.get('/availability', protect, async (req, res) => {
  try {
    const { date, role, floorId } = req.query;
    const targetDate = date ? new Date(`${date}T00:00:00.000Z`) : new Date();
    const normalizedDate = new Date(targetDate.toISOString().slice(0, 10));

    const staffQuery = { role: { $in: ['doctor', 'nurse'] } };
    if (role) staffQuery.role = role;
    const users = await User.find(staffQuery).lean();
    const userIds = users.map((u) => u._id);
    const profiles = await StaffProfile.find({ userId: { $in: userIds } }).lean();
    const profileMap = profiles.reduce((acc, profile) => {
      acc[String(profile.userId)] = profile;
      return acc;
    }, {});

    const profileIds = profiles.map((p) => p._id);
    const shifts = await Shift.find({
      assignedStaffId: { $in: profileIds },
      status: 'completed',
      workDate: normalizedDate,
    }).lean();

    const leaveRequests = await LeaveRequest.find({
      userId: { $in: userIds },
      status: 'approved',
      startDate: { $lte: normalizedDate },
      endDate: { $gte: normalizedDate },
    }).lean();
    const leaveMap = leaveRequests.reduce((acc, leave) => {
      acc[String(leave.userId)] = leave;
      return acc;
    }, {});

    const result = [];
    const summary = { ready: 0, caring: 0, offDuty: 0, onLeave: 0 };

    for (const user of users) {
      const profile = profileMap[String(user._id)] || null;
      const onLeave = Boolean(leaveMap[String(user._id)]);
      const activeShift = profile ? shifts.find((shift) => String(shift.assignedStaffId) === String(profile._id)) : null;
      const readinessLevel = onLeave ? 'on_leave' : activeShift ? 'caring' : 'ready';
      const availabilityStatus = onLeave ? 'On Leave' : activeShift ? 'On Duty' : 'Available';
      const readinessLabelVi = onLeave ? 'Nghỉ phép' : activeShift ? 'Đang chăm sóc' : 'Sẵn sàng';

      if (floorId) {
        const matchesFloor = Boolean(
          (activeShift && String(activeShift.floorId) === floorId) ||
          (profile && Array.isArray(profile.responsibleAreaIds) && profile.responsibleAreaIds.some((id) => String(id) === floorId))
        );
        if (!matchesFloor) continue;
      }

      const person = {
        _id: user._id,
        fullName: user.fullName,
        role: user.role,
        staffProfile: profile,
        readinessLevel,
        availabilityStatus,
        readinessLabelVi,
        checkedAt: new Date(),
      };

      result.push(person);
      if (readinessLevel === 'ready') summary.ready += 1;
      if (readinessLevel === 'caring') summary.caring += 1;
      if (readinessLevel === 'on_leave') summary.onLeave += 1;
      if (readinessLevel === 'off_duty') summary.offDuty += 1;
    }

    res.json({ data: result, summary, checkedAt: new Date().toISOString() });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// GET /api/staff/floors/:floorId/coverage
router.get('/floors/:floorId/coverage', protect, async (req, res) => {
  try {
    const floorId = req.params.floorId;
    res.json({ coverage: 'noCoverage', totalAssigned: 0, activeToday: 0, staff: [] });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

module.exports = router;

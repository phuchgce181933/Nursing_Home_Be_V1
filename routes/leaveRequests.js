const express = require('express');
const router = express.Router();
const LeaveRequest = require('../models/leaveRequest');
const { protect, authorize } = require('../middleware/auth');

// Submit a leave request (any authenticated user)
router.post('/', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const { startDate, endDate, reason } = req.body || {};
    if (!startDate || !endDate) return res.status(400).json({ message: 'startDate and endDate are required' });
    const lr = await LeaveRequest.create({ userId, startDate, endDate, reason });
    res.status(201).json({ data: lr });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// List leave requests
router.get('/', protect, async (req, res) => {
  try {
    const q = {};
    // admin/manager see all; others see own
    if (!req.user || !['admin','manager'].includes(req.user.role)) q.userId = req.user._id;
    const leaveRequests = await LeaveRequest.find(q).sort({ createdAt: -1 }).limit(200);
    res.json({ data: leaveRequests });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.get('/:id', protect, async (req, res) => {
  try {
    const lr = await LeaveRequest.findById(req.params.id);
    if (!lr) return res.status(404).json({ message: 'Leave request not found' });
    // authorize: owner or admin/manager
    if (!['admin','manager'].includes(req.user.role) && String(lr.userId) !== String(req.user._id))
      return res.status(403).json({ message: 'Access denied' });
    res.json({ data: lr });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// Approve
router.put('/:id/approve', protect, authorize('manager'), async (req, res) => {
  try {
    const { reviewNote } = req.body || {};
    const lr = await LeaveRequest.findById(req.params.id);
    if (!lr) return res.status(404).json({ message: 'Leave request not found' });
    lr.status = 'approved';
    lr.reviewNote = reviewNote || '';
    await lr.save();
    res.json({ data: lr, cancelledShifts: { count: 0, shifts: [] } });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// Reject
router.put('/:id/reject', protect, authorize('manager'), async (req, res) => {
  try {
    const { reviewNote } = req.body || {};
    if (!reviewNote) return res.status(400).json({ message: 'reviewNote is required' });
    const lr = await LeaveRequest.findById(req.params.id);
    if (!lr) return res.status(404).json({ message: 'Leave request not found' });
    lr.status = 'rejected';
    lr.reviewNote = reviewNote;
    await lr.save();
    res.json({ data: lr });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// Cancel own pending
router.delete('/:id', protect, async (req, res) => {
  try {
    const lr = await LeaveRequest.findById(req.params.id);
    if (!lr) return res.status(404).json({ message: 'Leave request not found' });
    if (String(lr.userId) !== String(req.user._id)) return res.status(403).json({ message: 'Access denied' });
    if (lr.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be cancelled' });
    lr.status = 'cancelled';
    await lr.save();
    res.json({ data: lr });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

module.exports = router;

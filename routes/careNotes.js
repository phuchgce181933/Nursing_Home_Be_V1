const express = require('express');
const router = express.Router();
const CareNote = require('../models/careNote');
const StaffProfile = require('../models/staffProfile');
const { protect, authorize } = require('../middleware/auth');
const { createAuditLog } = require('../utils/auditLog');

const STAFF_ROLES = ['admin', 'manager', 'doctor', 'nurse'];
const VALID_NOTE_TYPES = ['meal', 'activity', 'health', 'general'];

const populateNote = (query) =>
  query
    .populate('residentId', 'fullName residentCode')
    .populate({ path: 'authorStaffId', populate: { path: 'userId', select: 'fullName role' } });

// POST /api/care-notes — Create a care note
router.post('/', protect, authorize(...STAFF_ROLES), async (req, res) => {
  try {
    const { residentId, noteType, content, noteAt } = req.body;

    if (!residentId) return res.status(400).json({ message: 'residentId is required' });
    if (!content || content.trim().length < 5) {
      return res.status(400).json({ message: 'content is required and must be at least 5 characters' });
    }
    if (noteType && !VALID_NOTE_TYPES.includes(noteType)) {
      return res.status(400).json({ message: `noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}` });
    }

    const staffProfile = await StaffProfile.findOne({ userId: req.user._id });
    if (!staffProfile) {
      return res.status(400).json({ message: 'Staff profile not found for this account. Contact admin.' });
    }

    const note = await CareNote.create({
      residentId,
      authorStaffId: staffProfile._id,
      noteType: noteType || 'general',
      content: content.trim(),
      noteAt: noteAt ? new Date(noteAt) : new Date(),
    });

    await createAuditLog({
      actorUserId: req.user._id,
      actorRole: req.user.role,
      action: 'CREATE',
      module: 'CareNote',
      targetEntityType: 'CareNote',
      targetEntityId: note._id,
      afterData: note.toObject(),
      req,
    });

    const populated = await populateNote(CareNote.findById(note._id));
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/care-notes — List notes with search and filter
router.get('/', protect, authorize(...STAFF_ROLES), async (req, res) => {
  try {
    const { residentId, noteType, authorStaffId, search, from, to, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (residentId) filter.residentId = residentId;
    if (noteType) {
      if (!VALID_NOTE_TYPES.includes(noteType)) {
        return res.status(400).json({ message: `noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}` });
      }
      filter.noteType = noteType;
    }
    if (authorStaffId) filter.authorStaffId = authorStaffId;
    if (search) filter.content = { $regex: search.trim(), $options: 'i' };
    if (from || to) {
      filter.noteAt = {};
      if (from) filter.noteAt.$gte = new Date(from);
      if (to) filter.noteAt.$lte = new Date(to);
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      populateNote(CareNote.find(filter).sort({ noteAt: -1 }).skip(skip).limit(limitNum)),
      CareNote.countDocuments(filter),
    ]);

    res.json({ data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/care-notes/history/:residentId — Timeline history for one resident
router.get('/history/:residentId', protect, authorize(...STAFF_ROLES), async (req, res) => {
  try {
    const { noteType, from, to } = req.query;

    const filter = { residentId: req.params.residentId };
    if (noteType) filter.noteType = noteType;
    if (from || to) {
      filter.noteAt = {};
      if (from) filter.noteAt.$gte = new Date(from);
      if (to) filter.noteAt.$lte = new Date(to);
    }

    const notes = await populateNote(CareNote.find(filter).sort({ noteAt: -1 }));
    res.json(notes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/care-notes/:id — Get single note
router.get('/:id', protect, authorize(...STAFF_ROLES), async (req, res) => {
  try {
    const note = await populateNote(CareNote.findById(req.params.id));
    if (!note) return res.status(404).json({ message: 'Care note not found' });
    res.json(note);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/care-notes/:id — Update note
router.put('/:id', protect, authorize(...STAFF_ROLES), async (req, res) => {
  try {
    const note = await CareNote.findById(req.params.id);
    if (!note) return res.status(404).json({ message: 'Care note not found' });

    const { noteType, content, noteAt } = req.body;

    if (content !== undefined && content.trim().length < 5) {
      return res.status(400).json({ message: 'content must be at least 5 characters' });
    }
    if (noteType && !VALID_NOTE_TYPES.includes(noteType)) {
      return res.status(400).json({ message: `noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}` });
    }

    const before = note.toObject();
    if (noteType !== undefined) note.noteType = noteType;
    if (content !== undefined) note.content = content.trim();
    if (noteAt !== undefined) note.noteAt = new Date(noteAt);
    await note.save();

    await createAuditLog({
      actorUserId: req.user._id,
      actorRole: req.user.role,
      action: 'UPDATE',
      module: 'CareNote',
      targetEntityType: 'CareNote',
      targetEntityId: note._id,
      beforeData: before,
      afterData: note.toObject(),
      req,
    });

    const populated = await populateNote(CareNote.findById(note._id));
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/care-notes/:id — Delete note
router.delete('/:id', protect, authorize('admin', 'manager', 'doctor'), async (req, res) => {
  try {
    const note = await CareNote.findById(req.params.id);
    if (!note) return res.status(404).json({ message: 'Care note not found' });

    const before = note.toObject();
    await note.deleteOne();

    await createAuditLog({
      actorUserId: req.user._id,
      actorRole: req.user.role,
      action: 'DELETE',
      module: 'CareNote',
      targetEntityType: 'CareNote',
      targetEntityId: before._id,
      beforeData: before,
      req,
    });

    res.json({ message: 'Care note deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

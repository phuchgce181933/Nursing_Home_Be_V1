const express = require('express');
const router = express.Router();
const { createNote, listNotes, getNoteHistory, getNote, updateNote, deleteNote } = require('../controllers/careNoteController');
const { protect, authorize } = require('../middleware/auth');

const STAFF_ROLES = ['admin', 'manager', 'doctor', 'nurse'];

router.post('/', protect, authorize(...STAFF_ROLES), createNote);
router.get('/', protect, authorize(...STAFF_ROLES), listNotes);
router.get('/history/:residentId', protect, authorize(...STAFF_ROLES), getNoteHistory);
router.get('/:id', protect, authorize(...STAFF_ROLES), getNote);
router.put('/:id', protect, authorize(...STAFF_ROLES), updateNote);
router.delete('/:id', protect, authorize('admin', 'manager', 'doctor'), deleteNote);

module.exports = router;

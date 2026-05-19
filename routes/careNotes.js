const express = require('express');
const router = express.Router();
const { createNote, listNotes, getNoteHistory, getNote, updateNote, deleteNote } = require('../controllers/careNoteController');
const { protect, authorize } = require('../middleware/auth');

const STAFF_ROLES = ['admin', 'manager', 'doctor', 'nurse'];

/**
 * @swagger
 * /api/care-notes:
 *   post:
 *     summary: Create a new care note
 *     tags: [Care Notes]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               residentId:
 *                 type: string
 *               content:
 *                 type: string
 *               noteType:
 *                 type: string
 *                 enum: [meal, activity, health, general]
 *               noteAt:
 *                 type: string
 *                 format: date-time
 *                 description: Thời điểm ghi chú (mặc định là lúc tạo). Dùng để ghi nhận ngược thời gian.
 *     responses:
 *       201:
 *         description: Care note created
 */
router.post('/', protect, authorize(...STAFF_ROLES), createNote);

/**
 * @swagger
 * /api/care-notes:
 *   get:
 *     summary: List all care notes
 *     tags: [Care Notes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: List of care notes
 */
router.get('/', protect, authorize(...STAFF_ROLES), listNotes);

/**
 * @swagger
 * /api/care-notes/history/{residentId}:
 *   get:
 *     summary: Get care note history for a resident
 *     tags: [Care Notes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Note history retrieved
 */
router.get('/history/:residentId', protect, authorize(...STAFF_ROLES), getNoteHistory);

/**
 * @swagger
 * /api/care-notes/{id}:
 *   get:
 *     summary: Get care note by ID
 *     tags: [Care Notes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Care note details
 */
router.get('/:id', protect, authorize(...STAFF_ROLES), getNote);

/**
 * @swagger
 * /api/care-notes/{id}:
 *   put:
 *     summary: Update care note
 *     tags: [Care Notes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Care note updated
 */
router.put('/:id', protect, authorize(...STAFF_ROLES), updateNote);

/**
 * @swagger
 * /api/care-notes/{id}:
 *   delete:
 *     summary: Delete care note
 *     tags: [Care Notes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Care note deleted
 */
router.delete('/:id', protect, authorize('admin', 'manager', 'doctor'), deleteNote);

module.exports = router;

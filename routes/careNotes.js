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
 *             required: [residentId, content]
 *             properties:
 *               residentId:
 *                 type: string
 *                 example: "64f1a2b3c4d5e6f7a8b9c0d1"
 *               content:
 *                 type: string
 *                 minLength: 5
 *                 example: "Cụ ăn uống tốt, tâm trạng vui vẻ"
 *               noteType:
 *                 type: string
 *                 enum: [meal, activity, health, general]
 *                 default: general
 *                 example: "health"
 *               noteAt:
 *                 type: string
 *                 format: date-time
 *                 description: Thời điểm ghi chú (mặc định là lúc tạo). Dùng để ghi nhận ngược thời gian.
 *                 example: "2025-06-01T07:30:00.000Z"
 *     responses:
 *       201:
 *         description: Care note created
 *       400:
 *         description: Missing required fields or content too short
 */
router.post('/', protect, authorize(...STAFF_ROLES), createNote);

/**
 * @swagger
 * /api/care-notes:
 *   get:
 *     summary: List all care notes with filters
 *     tags: [Care Notes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
 *         description: Filter by resident ObjectId
 *       - in: query
 *         name: noteType
 *         schema:
 *           type: string
 *           enum: [meal, activity, health, general]
 *       - in: query
 *         name: authorStaffId
 *         schema:
 *           type: string
 *         description: Filter by author StaffProfile ObjectId
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Full-text search in note content
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter noteAt >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter noteAt <= to
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: List of care notes
 */
router.get('/', protect, authorize(...STAFF_ROLES), listNotes);

/**
 * @swagger
 * /api/care-notes/history/{residentId}:
 *   get:
 *     summary: Get full care note history for a resident (no pagination, all records)
 *     tags: [Care Notes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: noteType
 *         schema:
 *           type: string
 *           enum: [meal, activity, health, general]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
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
 *       404:
 *         description: Care note not found
 */
router.get('/:id', protect, authorize(...STAFF_ROLES), getNote);

/**
 * @swagger
 * /api/care-notes/{id}:
 *   put:
 *     summary: Update a care note
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
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *                 minLength: 5
 *                 example: "Cụ ăn được nửa bát cháo, nghỉ ngơi tốt"
 *               noteType:
 *                 type: string
 *                 enum: [meal, activity, health, general]
 *                 example: "meal"
 *               noteAt:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-06-01T12:00:00.000Z"
 *     responses:
 *       200:
 *         description: Care note updated
 *       400:
 *         description: Content too short or invalid noteType
 *       404:
 *         description: Care note not found
 */
router.put('/:id', protect, authorize(...STAFF_ROLES), updateNote);

/**
 * @swagger
 * /api/care-notes/{id}:
 *   delete:
 *     summary: Delete care note (Admin/Manager/Doctor only)
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
 *       404:
 *         description: Care note not found
 */
router.delete('/:id', protect, authorize('admin', 'manager', 'doctor'), deleteNote);

module.exports = router;

const express = require('express');
const router = express.Router();
const {
  createNote,
  listNotes,
  getNoteHistory,
  getNote,
  updateNote,
  deleteNote,
  getMyNotes,
} = require('../controllers/careNoteController');
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
 *               noteAt:
 *                 type: string
 *                 format: date-time
 *                 description: Thời điểm ghi chú (mặc định là lúc tạo)
 *               metadata:
 *                 type: object
 *                 description: |
 *                   Dữ liệu có cấu trúc theo noteType:
 *                   - meal: { mealType, intakeAmount, appetite }
 *                   - activity: { activityType, duration(phút), participationLevel, mood }
 *                   - health: { symptoms(mảng), consciousness, fallRisk, skinCondition, observations }
 *                 example:
 *                   mealType: "lunch"
 *                   intakeAmount: "most"
 *                   appetite: "good"
 *     responses:
 *       201:
 *         description: Care note created
 *       400:
 *         description: Missing required fields, content too short, or invalid metadata values
 */
router.post('/', protect, authorize('doctor', 'nurse'), createNote);

/**
 * @swagger
 * /api/care-notes:
 *   get:
 *     summary: List all care notes with filters and pagination
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
 *         description: Full-text search in note content (case-insensitive)
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
 *         description: Paginated list of care notes
 */
router.get('/', protect, authorize(...STAFF_ROLES), listNotes);

/**
 * @swagger
 * /api/care-notes/my-notes:
 *   get:
 *     summary: Get care notes written by the currently authenticated staff
 *     tags: [Care Notes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
 *       - in: query
 *         name: noteType
 *         schema:
 *           type: string
 *           enum: [meal, activity, health, general]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
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
 *         description: Paginated list of the current staff's care notes
 */
router.get('/my-notes', protect, authorize('doctor', 'nurse'), getMyNotes);

/**
 * @swagger
 * /api/care-notes/history/{residentId}:
 *   get:
 *     summary: Get full care note history for a resident (all records, no pagination)
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
 *     summary: Update a care note (nurses can only update their own notes)
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
 *               noteType:
 *                 type: string
 *                 enum: [meal, activity, health, general]
 *               noteAt:
 *                 type: string
 *                 format: date-time
 *               metadata:
 *                 type: object
 *     responses:
 *       200:
 *         description: Care note updated
 *       400:
 *         description: Content too short or invalid noteType/metadata values
 *       403:
 *         description: Nurse attempting to edit another staff's note
 *       404:
 *         description: Care note not found
 */
router.put('/:id', protect, authorize('doctor', 'nurse'), updateNote);

/**
 * @swagger
 * /api/care-notes/{id}:
 *   delete:
 *     summary: Delete care note (nurses can only delete their own notes)
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
 *       403:
 *         description: Nurse attempting to delete another staff's note
 *       404:
 *         description: Care note not found
 */
router.delete('/:id', protect, authorize('doctor', 'nurse'), deleteNote);

module.exports = router;

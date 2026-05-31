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

// Doctor and Nurse write; admin/manager can view for oversight
const WRITE_ROLES = ['doctor', 'nurse'];
const READ_ROLES = ['admin', 'manager', 'doctor', 'nurse'];

/**
 * @swagger
 * tags:
 *   name: Care Notes
 *   description: UC13 — Care Notes Management (Doctor & Nurse)
 */

/**
 * @swagger
 * /api/care-notes:
 *   post:
 *     summary: Create a care note (UC13 — Record Meal / Activity / Health / General note)
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
 *                 description: |
 *                   - meal: ghi nhận bữa ăn (Record Meal Intake Notes)
 *                   - activity: ghi nhận hoạt động sinh hoạt (Record Daily Activity Notes)
 *                   - health: ghi nhận tình trạng sức khỏe (Record Health Condition Notes)
 *                   - general: ghi chú chung
 *               noteAt:
 *                 type: string
 *                 format: date-time
 *                 description: Thời điểm ghi chú (mặc định là lúc tạo, không được ở tương lai)
 *               metadata:
 *                 type: object
 *                 description: |
 *                   Dữ liệu có cấu trúc theo noteType:
 *                   - meal: { mealType: breakfast|lunch|dinner|snack, intakeAmount: none|little|half|most|all, appetite: poor|fair|good|excellent }
 *                   - activity: { activityType: walking|exercise|physiotherapy|bathing|grooming|reading|socializing|other, duration(phút), participationLevel: refused|assisted|supervised|independent, mood: happy|neutral|sad|agitated|anxious }
 *                   - health: { symptoms(mảng chuỗi), consciousness: alert|confused|drowsy|unresponsive, fallRisk: low|medium|high, skinCondition(chuỗi tự do), observations(chuỗi tự do) }
 *                 example:
 *                   mealType: "lunch"
 *                   intakeAmount: "most"
 *                   appetite: "good"
 *     responses:
 *       201:
 *         description: Care note created
 *       400:
 *         description: Missing required fields, content too short, resident not admitted, or invalid metadata
 *       404:
 *         description: Resident not found
 */
router.post('/', protect, authorize(...WRITE_ROLES), createNote);

/**
 * @swagger
 * /api/care-notes:
 *   get:
 *     summary: List care notes with filters, search, and pagination (UC13 — View List / Search / Filter)
 *     tags: [Care Notes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
 *         description: Lọc theo cư dân
 *       - in: query
 *         name: noteType
 *         schema:
 *           type: string
 *           enum: [meal, activity, health, general]
 *         description: Lọc theo loại ghi chú (Filter by Type)
 *       - in: query
 *         name: authorStaffId
 *         schema:
 *           type: string
 *         description: Lọc theo StaffProfile._id của tác giả
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Tìm kiếm trong nội dung ghi chú (Search Care Notes)
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: noteAt >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: noteAt <= to
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
router.get('/', protect, authorize(...READ_ROLES), listNotes);

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
router.get('/my-notes', protect, authorize(...WRITE_ROLES), getMyNotes);

/**
 * @swagger
 * /api/care-notes/history/{residentId}:
 *   get:
 *     summary: Get paginated care note history for a resident (UC13 — View Care Note History)
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
 *         name: search
 *         schema:
 *           type: string
 *         description: Tìm kiếm trong nội dung ghi chú
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
 *         description: Paginated note history with resident info
 *       404:
 *         description: Resident not found
 */
router.get('/history/:residentId', protect, authorize(...READ_ROLES), getNoteHistory);

/**
 * @swagger
 * /api/care-notes/{id}:
 *   get:
 *     summary: Get care note detail by ID
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
router.get('/:id', protect, authorize(...READ_ROLES), getNote);

/**
 * @swagger
 * /api/care-notes/{id}:
 *   put:
 *     summary: Update a care note (UC13 — Edit Care Notes; nurse can only edit own notes)
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
 *                 description: Thay đổi noteType sẽ xóa metadata cũ (nếu không cung cấp metadata mới)
 *               noteAt:
 *                 type: string
 *                 format: date-time
 *                 description: Không được ở tương lai
 *               metadata:
 *                 type: object
 *     responses:
 *       200:
 *         description: Care note updated
 *       400:
 *         description: Content too short, invalid noteType/metadata, or noteAt in the future
 *       403:
 *         description: Nurse attempting to edit another staff's note
 *       404:
 *         description: Care note not found
 */
router.put('/:id', protect, authorize(...WRITE_ROLES), updateNote);

/**
 * @swagger
 * /api/care-notes/{id}:
 *   delete:
 *     summary: Delete a care note (UC13 — Delete Care Notes; nurse can only delete own notes)
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
router.delete('/:id', protect, authorize(...WRITE_ROLES), deleteNote);

module.exports = router;

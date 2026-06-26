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

const STAFF_ROLES = ['admin', 'doctor', 'nurse'];

/**
 * @swagger
 * /api/care-notes:
 *   post:
 *     summary: Tạo ghi chú chăm sóc mới
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
 *                 enum: [meal, activity, daily_living, health, general]
 *                 default: general
 *                 description: |
 *                   - meal: ghi chú bữa ăn
 *                   - activity: hoạt động giải trí / chương trình tập thể
 *                   - daily_living: hoạt động sinh hoạt hằng ngày (ADL)
 *                   - health: tình trạng sức khỏe và thay đổi thể trạng
 *                   - general: ghi chú chung
 *               noteAt:
 *                 type: string
 *                 format: date-time
 *                 description: Thời điểm ghi chú (mặc định là lúc tạo, không được là tương lai)
 *               metadata:
 *                 type: object
 *                 description: |
 *                   Dữ liệu có cấu trúc theo noteType:
 *
 *                   **meal**: { mealType, intakeAmount, appetite }
 *                   - mealType: breakfast | lunch | dinner | snack
 *                   - intakeAmount: none | little | half | most | all
 *                   - appetite: poor | fair | good | excellent
 *
 *                   **activity**: { activityType, duration(phút), participationLevel, mood }
 *                   - activityType: walking | exercise | physiotherapy | reading | socializing | entertainment | other
 *                   - participationLevel: refused | assisted | supervised | independent
 *                   - mood: happy | neutral | sad | agitated | anxious
 *
 *                   **daily_living** (hoạt động sinh hoạt hằng ngày): { activityType, assistanceLevel, completionStatus, duration(phút), mood }
 *                   - activityType: bathing | grooming | dressing | eating | mobility | toileting | sleeping | other
 *                   - assistanceLevel: independent | supervised | assisted | total_care
 *                   - completionStatus: completed | partial | refused
 *                   - mood: happy | neutral | sad | agitated | anxious
 *
 *                   **health** (tình trạng sức khỏe & thay đổi thể trạng): { symptoms[], consciousness, fallRisk, skinCondition, painLevel, physicalChanges, temperature, pulse, observations }
 *                   - symptoms: mảng chuỗi mô tả triệu chứng (VD: ["sốt", "ho"])
 *                   - consciousness: alert | confused | drowsy | unresponsive
 *                   - fallRisk: low | medium | high
 *                   - painLevel: số 0–10 (thang đau)
 *                   - temperature: nhiệt độ cơ thể (°C, 30–45)
 *                   - pulse: nhịp tim (bpm, 20–300)
 *                   - physicalChanges: mô tả thay đổi thể trạng (sụt cân, phù nề...)
 *                   - skinCondition: tình trạng da
 *                   - observations: ghi chú bổ sung
 *                 example:
 *                   activityType: "bathing"
 *                   assistanceLevel: "assisted"
 *                   completionStatus: "completed"
 *                   duration: 20
 *     responses:
 *       201:
 *         description: Ghi chú chăm sóc được tạo thành công
 *       400:
 *         description: Thiếu trường bắt buộc, nội dung quá ngắn, hoặc giá trị metadata không hợp lệ
 *       404:
 *         description: Resident không tồn tại
 */
router.post('/', protect, authorize('doctor', 'nurse'), createNote);

/**
 * @swagger
 * /api/care-notes:
 *   get:
 *     summary: Xem danh sách ghi chú chăm sóc (có lọc, tìm kiếm, phân trang)
 *     tags: [Care Notes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
 *         description: Lọc theo resident
 *       - in: query
 *         name: noteType
 *         schema:
 *           type: string
 *           enum: [meal, activity, daily_living, health, general]
 *         description: Lọc theo loại ghi chú
 *       - in: query
 *         name: authorStaffId
 *         schema:
 *           type: string
 *         description: Lọc theo tác giả (StaffProfile ObjectId)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Tìm kiếm trong nội dung ghi chú (không phân biệt hoa thường)
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-06-04"
 *         description: Lọc theo ngày cụ thể (YYYY-MM-DD), ưu tiên hơn from/to
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Lọc noteAt >= from (bỏ qua nếu có date)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Lọc noteAt <= to (bỏ qua nếu có date)
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
 *         description: Danh sách ghi chú chăm sóc có phân trang
 */
router.get('/', protect, authorize(...STAFF_ROLES), listNotes);

/**
 * @swagger
 * /api/care-notes/my-notes:
 *   get:
 *     summary: Xem ghi chú chăm sóc do chính mình tạo
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
 *           enum: [meal, activity, daily_living, health, general]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-06-04"
 *         description: Lọc theo ngày cụ thể (YYYY-MM-DD), ưu tiên hơn from/to
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
 *         description: Danh sách ghi chú chăm sóc của y tá đang đăng nhập
 */
router.get('/my-notes', protect, authorize('doctor', 'nurse'), getMyNotes);

/**
 * @swagger
 * /api/care-notes/history/{residentId}:
 *   get:
 *     summary: Xem lịch sử ghi chú chăm sóc của một resident (có phân trang)
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
 *           enum: [meal, activity, daily_living, health, general]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Tìm kiếm trong nội dung ghi chú
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-06-04"
 *         description: Lọc theo ngày cụ thể (YYYY-MM-DD), ưu tiên hơn from/to
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
 *         description: Lịch sử ghi chú chăm sóc có phân trang
 *       400:
 *         description: residentId không hợp lệ
 */
router.get('/history/:residentId', protect, authorize(...STAFF_ROLES), getNoteHistory);

/**
 * @swagger
 * /api/care-notes/{id}:
 *   get:
 *     summary: Xem chi tiết một ghi chú chăm sóc
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
 *         description: Chi tiết ghi chú chăm sóc
 *       404:
 *         description: Không tìm thấy ghi chú
 */
router.get('/:id', protect, authorize(...STAFF_ROLES), getNote);

/**
 * @swagger
 * /api/care-notes/{id}:
 *   put:
 *     summary: Chỉnh sửa ghi chú chăm sóc (y tá chỉ sửa được ghi chú của mình)
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
 *                 enum: [meal, activity, daily_living, health, general]
 *               noteAt:
 *                 type: string
 *                 format: date-time
 *                 description: Không được là thời điểm tương lai
 *               metadata:
 *                 type: object
 *                 description: Xem mô tả metadata ở POST /api/care-notes
 *     responses:
 *       200:
 *         description: Ghi chú đã được cập nhật
 *       400:
 *         description: Nội dung quá ngắn hoặc giá trị metadata không hợp lệ
 *       403:
 *         description: Y tá cố sửa ghi chú của người khác
 *       404:
 *         description: Không tìm thấy ghi chú
 */
router.put('/:id', protect, authorize('doctor', 'nurse'), updateNote);

/**
 * @swagger
 * /api/care-notes/{id}:
 *   delete:
 *     summary: Xóa ghi chú chăm sóc (y tá chỉ xóa được ghi chú của mình)
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
 *         description: Ghi chú đã được xóa
 *       403:
 *         description: Y tá cố xóa ghi chú của người khác
 *       404:
 *         description: Không tìm thấy ghi chú
 */
router.delete('/:id', protect, authorize('doctor', 'nurse'), deleteNote);

module.exports = router;

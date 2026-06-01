const express = require('express');
const router = express.Router();
const {
  getResidents,
  getResident,
  getVitals,
  getHealthHistory,
  getHealthChart,
  getCareNotes,
  getMedications,
  getPrescriptions,
  getActivities,
  getCareAppointments,
  getHealthReport,
  downloadHealthReport,
} = require('../controllers/familyPortalController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('family'));

/**
 * @swagger
 * tags:
 *   name: Family Portal
 *   description: UC14 — Family Portal & Remote Monitoring (role family)
 */

/**
 * @swagger
 * /api/family/residents:
 *   get:
 *     summary: Danh sách cư dân liên kết với tài khoản gia đình (Remote Monitoring)
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Danh sách cư dân kèm thông tin phòng/giường
 */
router.get('/residents', getResidents);

/**
 * @swagger
 * /api/family/residents/{residentId}:
 *   get:
 *     summary: Xem thông tin cá nhân cơ bản của cư dân (View Basic Profile Information)
 *     tags: [Family Portal]
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
 *         description: Thông tin cá nhân cư dân
 *       403:
 *         description: Không có quyền truy cập
 *       404:
 *         description: Không tìm thấy cư dân
 */
router.get('/residents/:residentId', getResident);

/**
 * @swagger
 * /api/family/residents/{residentId}/vitals:
 *   get:
 *     summary: Xem chỉ số sức khỏe hiện tại (View Current Health Indicators)
 *     tags: [Family Portal]
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
 *         description: Bản ghi đo lường mới nhất (null nếu chưa có dữ liệu)
 *       403:
 *         description: Không có quyền truy cập
 */
router.get('/residents/:residentId/vitals', getVitals);

/**
 * @swagger
 * /api/family/residents/{residentId}/health-history:
 *   get:
 *     summary: Lịch sử chỉ số sức khỏe (View Health Indicator History / Search / Filter)
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Lọc measuredAt >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Lọc measuredAt <= to
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Tìm kiếm trong trường summary
 *       - in: query
 *         name: abnormalOnly
 *         schema:
 *           type: boolean
 *         description: "true = chỉ lấy bản ghi bất thường"
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
 *         description: Danh sách bản ghi sức khỏe phân trang
 *       403:
 *         description: Không có quyền truy cập
 */
router.get('/residents/:residentId/health-history', getHealthHistory);

/**
 * @swagger
 * /api/family/residents/{residentId}/health-chart:
 *   get:
 *     summary: Dữ liệu biểu đồ sức khỏe (View Health Charts) — mặc định 30 ngày gần nhất
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [bloodPressureSystolic, bloodPressureDiastolic, pulse, temperatureCelsius, oxygenSaturation, bloodSugar, weightKg]
 *         description: Chỉ số cụ thể cần lấy (bỏ trống = lấy tất cả)
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
 *         description: Mảng dữ liệu chuỗi thời gian (measuredAt + các chỉ số)
 *       400:
 *         description: metric không hợp lệ
 *       403:
 *         description: Không có quyền truy cập
 */
router.get('/residents/:residentId/health-chart', getHealthChart);

/**
 * @swagger
 * /api/family/residents/{residentId}/care-notes:
 *   get:
 *     summary: Nhật ký chăm sóc (View Care Logs / Search / Filter by Type)
 *     tags: [Family Portal]
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
 *         description: Lọc theo loại ghi chú
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
 *         description: Nhật ký chăm sóc phân trang
 *       403:
 *         description: Không có quyền truy cập
 */
router.get('/residents/:residentId/care-notes', getCareNotes);

/**
 * @swagger
 * /api/family/residents/{residentId}/medications:
 *   get:
 *     summary: Lịch sử dùng thuốc (View Medication History / Filter)
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, TAKEN, LATE_TAKEN, MISSED, SKIPPED, OVERDUE]
 *         description: Lọc theo trạng thái uống thuốc
 *       - in: query
 *         name: medicationName
 *         schema:
 *           type: string
 *         description: Tìm kiếm theo tên thuốc
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Lọc scheduledTime >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Lọc scheduledTime <= to
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
 *         description: Lịch sử dùng thuốc phân trang
 *       403:
 *         description: Không có quyền truy cập
 */
router.get('/residents/:residentId/medications', getMedications);

/**
 * @swagger
 * /api/family/residents/{residentId}/prescriptions:
 *   get:
 *     summary: Danh sách đơn thuốc (View Medication History)
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, COMPLETED, CANCELLED, PAUSED]
 *         description: Lọc theo trạng thái đơn thuốc
 *       - in: query
 *         name: medicationName
 *         schema:
 *           type: string
 *         description: Tìm kiếm theo tên thuốc
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
 *         description: Danh sách đơn thuốc phân trang (sắp xếp theo prescriptionDate giảm dần)
 *       403:
 *         description: Không có quyền truy cập
 */
router.get('/residents/:residentId/prescriptions', getPrescriptions);

/**
 * @swagger
 * /api/family/residents/{residentId}/activities:
 *   get:
 *     summary: Lịch hoạt động hằng ngày (View Daily Activity Schedule)
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, scheduled, ongoing, completed, cancelled]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Tìm theo tên hoạt động hoặc danh mục
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Lọc scheduledAt >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Lọc scheduledAt <= to
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
 *         description: Lịch hoạt động phân trang
 *       403:
 *         description: Không có quyền truy cập
 */
router.get('/residents/:residentId/activities', getActivities);

/**
 * @swagger
 * /api/family/residents/{residentId}/care-appointments:
 *   get:
 *     summary: Lịch chăm sóc và lịch khám bệnh (View Medical and Care Schedules)
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [scheduled, in_progress, completed, cancelled]
 *       - in: query
 *         name: appointmentType
 *         schema:
 *           type: string
 *         description: Lọc/tìm kiếm theo loại hẹn
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Lọc scheduledStartAt >= from
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Lọc scheduledStartAt <= to
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
 *         description: Lịch chăm sóc & khám bệnh phân trang
 *       403:
 *         description: Không có quyền truy cập
 */
router.get('/residents/:residentId/care-appointments', getCareAppointments);

/**
 * @swagger
 * /api/family/residents/{residentId}/report:
 *   get:
 *     summary: Báo cáo sức khỏe tổng hợp dạng JSON (Remote Monitoring)
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Từ ngày (không bắt buộc)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Đến ngày (không bắt buộc)
 *     responses:
 *       200:
 *         description: Báo cáo JSON gồm vitals, care notes, appointments, medications, prescriptions
 *       403:
 *         description: Không có quyền truy cập
 *       404:
 *         description: Không tìm thấy cư dân
 */
router.get('/residents/:residentId/report', getHealthReport);

/**
 * @swagger
 * /api/family/residents/{residentId}/report/download:
 *   get:
 *     summary: Tải báo cáo sức khỏe dạng CSV (Download Health Reports)
 *     description: |
 *       Trả về file CSV UTF-8 (có BOM để Excel mở đúng tiếng Việt).
 *       File gồm 5 section: Chỉ số sức khỏe, Nhật ký chăm sóc, Lịch sử dùng thuốc, Đơn thuốc, Lịch chăm sóc.
 *     tags: [Family Portal]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Từ ngày (không bắt buộc)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Đến ngày (không bắt buộc)
 *     responses:
 *       200:
 *         description: File CSV — Content-Disposition attachment
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *               format: binary
 *       403:
 *         description: Không có quyền truy cập
 *       404:
 *         description: Không tìm thấy cư dân
 */
router.get('/residents/:residentId/report/download', downloadHealthReport);

module.exports = router;

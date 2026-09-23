const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/caregiverResidentController');
const photoCtrl = require('../controllers/residentPhotoController');
const { uploadResidentPhotos } = require('../middleware/uploadMiddleware');
const { protect, authorize } = require('../middleware/auth');

const CAREGIVER_ROLES = ['caregiver'];

/**
 * @swagger
 * tags:
 *   name: CaregiverResidents
 *   description: Caregiver view of assigned residents (read-only)
 */

/**
 * @swagger
 * /api/caregiver/residents:
 *   get:
 *     summary: List residents assigned to the logged-in caregiver
 *     tags: [CaregiverResidents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Filter by fullName or residentCode
 *     responses:
 *       200:
 *         description: Assigned admitted residents
 */
router.get('/', protect, authorize(...CAREGIVER_ROLES), ctrl.listResidents);
router.get('/activities', protect, authorize(...CAREGIVER_ROLES), ctrl.listResidentActivities);

/**
 * @swagger
 * /api/caregiver/residents/rooms:
 *   get:
 *     summary: Phòng của những cư dân mà hộ lý đang đăng nhập được phân công
 *     description: |
 *       Chỉ trả về các phòng đang có cư dân thuộc `assignedResidentIds` của chính
 *       người gọi. Đây KHÔNG phải danh sách phòng toàn cơ sở — muốn xem toàn bộ
 *       phòng phải dùng `/api/facilities` với quyền quản trị.
 *       Mỗi phòng chỉ liệt kê những cư dân nằm trong phạm vi phân công.
 *     tags: [CaregiverResidents]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Danh sách phòng trong phạm vi phụ trách
 *       404:
 *         description: Không tìm thấy hồ sơ nhân viên của người gọi
 */
router.get('/rooms', protect, authorize(...CAREGIVER_ROLES), ctrl.listRooms);

/**
 * @swagger
 * /api/caregiver/residents/{id}:
 *   get:
 *     summary: Get one assigned resident detail
 *     tags: [CaregiverResidents]
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
 *         description: Resident detail
 *       403:
 *         description: Not in assigned list
 */
router.get('/:id', protect, authorize(...CAREGIVER_ROLES), ctrl.getResident);

/**
 * @swagger
 * /api/caregiver/residents/{id}/photos:
 *   post:
 *     summary: Upload one or more photos for an assigned resident
 *     tags: [CaregiverResidents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201: { description: Photos uploaded }
 *       400: { description: Validation error }
 *       403: { description: Not assigned to this resident }
 */
router.post('/:id/photos', protect, authorize(...CAREGIVER_ROLES), uploadResidentPhotos, photoCtrl.addPhotos);

/**
 * @swagger
 * /api/caregiver/residents/{id}/photos:
 *   get:
 *     summary: List photos uploaded for an assigned resident
 *     tags: [CaregiverResidents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Photo list }
 */
router.get('/:id/photos', protect, authorize(...CAREGIVER_ROLES), photoCtrl.listPhotosForCaregiver);

/**
 * @swagger
 * /api/caregiver/residents/{id}/photos/{photoId}:
 *   delete:
 *     summary: Delete a photo from an assigned resident
 *     tags: [CaregiverResidents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: photoId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       404: { description: Photo not found }
 */
router.delete('/:id/photos/:photoId', protect, authorize(...CAREGIVER_ROLES), photoCtrl.deletePhoto);

module.exports = router;

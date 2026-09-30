const express = require('express');
const router = express.Router();
const {
  createContract,
  listContracts,
  getContractDetails,
  renewContract,
  terminateContract,
  getContractHistory,
  getContractsByResident,
  issueInvoices,
  recalculateContractInvoices,
  updateDraftInvoicePrice,
  cancelDraftInvoice,
  transitionInvoiceStatus,
} = require('../controllers/contractController');
const {
  createInvoiceFromContract,
  exportInvoiceHtml,
} = require('../controllers/contractInvoiceController');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   name: Admin - Contract Management
 *   description: Contract lifecycle (UC-210 to UC-215)
 */

/**
 * @swagger
 * /api/admin/contracts:
 *   get:
 *     summary: List all contracts (UC-211)
 *     tags: [Admin - Contract Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, active, expired, cancelled, terminated]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: admissionId
 *         schema:
 *           type: string
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
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
 *         description: Paginated list of contracts
 */
router.get('/', protect, authorize('admin', 'doctor', 'nurse'), listContracts);

/**
 * @swagger
 * /api/admin/contracts/{contractId}:
 *   get:
 *     summary: View contract details (UC-212)
 *     tags: [Admin - Contract Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Contract details with invoices and outstanding amount
 *       404:
 *         description: Contract not found
 */
router.get('/:contractId', protect, authorize('admin', 'doctor', 'nurse'), getContractDetails);

/**
 * @swagger
 * /api/admin/contracts/{contractId}/renew:
 *   patch:
 *     summary: Renew contract (UC-213)
 *     tags: [Admin - Contract Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 *               durationMonths:
 *                 type: integer
 *               discountPercent:
 *                 type: number
 *               servicePackageId:
 *                 type: string
 *               terms:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: New contract created, old one marked as expired
 */
router.patch('/:contractId/renew', protect, authorize('admin'), renewContract);

/**
 * @swagger
 * /api/admin/contracts/{contractId}/terminate:
 *   patch:
 *     summary: Terminate contract (UC-214)
 *     tags: [Admin - Contract Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *               cancellationReason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Contract terminated, pending invoices cancelled
 */
router.patch('/:contractId/terminate', protect, authorize('admin'), terminateContract);

/**
 * @swagger
 * /api/admin/contracts/{contractId}/create-invoice:
 *   post:
 *     summary: Create invoice from contract (UC-128) - After contract is created
 *     description: |
 *       Creates an invoice for the service fees covered by this contract.
 *       Flow: Doctor khám xong → Tạo Hợp đồng → Tạo Hóa đơn (current step)
 *       
 *       The invoice will include:
 *       - careServiceCost = monthlyFee × durationMonths × (1 - discountPercent/100)
 *       - optional roomCost
 *     tags: [Admin - Contract Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               careServiceCost:
 *                 type: number
 *                 description: Override monthly fee (uses contract.monthlyFee if not provided)
 *               durationMonths:
 *                 type: integer
 *                 description: Override duration (uses contract.durationMonths if not provided)
 *               roomCost:
 *                 type: number
 *               billingPeriodStart:
 *                 type: string
 *                 format: date
 *               billingPeriodEnd:
 *                 type: string
 *                 format: date
 *               dueDate:
 *                 type: string
 *                 format: date
 *               paymentPlan:
 *                 type: string
 *                 enum: [FULL, HALF_NOW]
 *                 default: FULL
 *     responses:
 *       201:
 *         description: Invoice created successfully
 *       400:
 *         description: Invalid data or contract not active
 *       404:
 *         description: Contract not found
 *       409:
 *         description: Already has a pending service invoice
 */
router.post('/:contractId/create-invoice', protect, authorize('admin'), createInvoiceFromContract);

/**
 * @swagger
 * /api/admin/contracts/history/{admissionId}:
 *   get:
 *     summary: View contract history (UC-215)
 *     tags: [Admin - Contract Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: admissionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: All contracts and invoices for the admission
 */
router.get('/history/:admissionId', protect, authorize('admin'), getContractHistory);

/**
 * @swagger
 * /api/admin/contracts/by-resident/{residentId}:
 *   get:
 *     summary: Lấy tất cả hợp đồng của một cư dân (gồm cả hợp đồng cũ đã chấm dứt/hết hạn)
 *     description: |
 *       Trả về danh sách đầy đủ hợp đồng của một cư dân (resident) — gồm cả
 *       hợp đồng đang active lẫn các hợp đồng cũ đã bị chấm dứt (terminated),
 *       hết hạn (expired) hoặc hủy (cancelled). Dùng để hiển thị lịch sử hợp
 *       đồng trong modal chi tiết.
 *     tags: [Admin - Contract Management]
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
 *         description: Mảng hợp đồng (sắp xếp theo createdAt desc — hợp đồng mới nhất trước)
 *       400:
 *         description: residentId không hợp lệ
 */
router.get('/by-resident/:residentId', protect, authorize('admin', 'doctor', 'nurse'), getContractsByResident);

/**
 * @swagger
 * /api/admin/contracts/{contractId}/issue-invoices:
 *   post:
 *     summary: Issue (xuất) các hóa đơn DRAFT của hợp đồng — flip DRAFT → ISSUED
 *     description: |
 *       Khi tạo hợp đồng, các hóa đơn sẽ ở trạng thái DRAFT (chưa xuất) và chỉ
 *       Admin nhìn thấy. Endpoint này chuyển các hóa đơn DRAFT sang ISSUED (đã xuất)
 *       để gia đình (Family portal) nhìn thấy và thanh toán được.
 *     tags: [Admin - Contract Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               invoiceIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Danh sách invoiceId cụ thể cần xuất. Nếu bỏ trống thì xuất tất cả DRAFT của hợp đồng.
 *     responses:
 *       200:
 *         description: Số hóa đơn đã xuất
 *       400:
 *         description: Hợp đồng không active hoặc không có DRAFT nào
 *       404:
 *         description: Không tìm thấy hợp đồng
 */
router.post('/:contractId/issue-invoices', protect, authorize('admin'), issueInvoices);

/**
 * @swagger
 * /api/admin/contracts/{contractId}/recalculate-invoices:
 *   post:
 *     summary: Tính lại giá cho các hóa đơn DRAFT của hợp đồng
 *     description: |
 *       Cập nhật lại careServiceCost, total, totalAmount, remainingAmount,
 *       originalTotalAmount, subTotal cho các hóa đơn DRAFT của hợp đồng dựa
 *       trên monthlyFee hiện tại (lấy từ contract hoặc servicePackage).
 *       Hóa đơn đã xuất (ISSUED/PAID/...) không bị ảnh hưởng.
 *     tags: [Admin - Contract Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Số hóa đơn đã tính lại
 *       400:
 *         description: monthlyFee vẫn bằng 0 hoặc không có hóa đơn DRAFT
 *       404:
 *         description: Không tìm thấy hợp đồng
 */
router.post('/:contractId/recalculate-invoices', protect, authorize('admin'), recalculateContractInvoices);

/**
 * @swagger
 * /api/admin/contracts/invoices/{invoiceId}/export:
 *   get:
 *     summary: Xuất hóa đơn ra file HTML (in / lưu PDF được)
 *     description: |
 *       Trả về một file HTML self-contained (không phụ thuộc asset ngoài) chứa đầy đủ
 *       thông tin hóa đơn, hợp đồng, người cao tuổi, người thanh toán và bảng kê.
 *       Mở file sẽ có sẵn nút "In / Lưu PDF" để người dùng chuyển sang PDF qua hộp thoại in của trình duyệt.
 *     tags: [Admin - Contract Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: HTML hóa đơn
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       404:
 *         description: Không tìm thấy hóa đơn
 */
router.get('/invoices/:invoiceId/export', protect, authorize('admin', 'doctor', 'nurse'), exportInvoiceHtml);

/**
 * @swagger
 * /api/admin/contracts/invoices/{invoiceId}:
 *   patch:
 *     summary: Sửa hóa đơn DRAFT (trước khi xuất)
 *     description: |
 *       Admin có thể chỉnh **kỳ bắt đầu tính phí** (`billingPeriodStart`) và
 *       **phí dịch vụ chăm sóc** (`careServiceCost`) của một hóa đơn đang ở
 *       trạng thái DRAFT (chưa xuất). Server tự động tính lại
 *       subTotal, total, totalAmount, remainingAmount, originalTotalAmount
 *       dựa trên giá trị mới.
 *       Hóa đơn đã xuất (ISSUED/PARTIALLY_PAID/PAID/CANCELLED) không thể sửa
 *       qua endpoint này.
 *     tags: [Admin - Contract Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               billingPeriodStart:
 *                 type: string
 *                 format: date
 *                 description: Kỳ bắt đầu tính phí (đồng bộ cả periodStart legacy)
 *               careServiceCost:
 *                 type: integer
 *                 description: Phí dịch vụ chăm sóc (VND)
 *               reason:
 *                 type: string
 *                 description: Lý do sửa (lưu audit log)
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 *       400:
 *         description: Hóa đơn không ở DRAFT hoặc thiếu field
 *       404:
 *         description: Không tìm thấy hóa đơn
 */
router.patch('/invoices/:invoiceId', protect, authorize('admin'), updateDraftInvoicePrice);

/**
 * @swagger
 * /api/admin/contracts/invoices/{invoiceId}/cancel:
 *   patch:
 *     summary: Dừng (xóa mềm) hóa đơn DRAFT
 *     description: |
 *       Admin "Dừng" hóa đơn Nháp trước khi xuất: set `deletedAt` + `deletedBy`,
 *       chuyển status sang `CANCELLED`. Hóa đơn bị ẩn khỏi danh sách mặc định nhưng
 *       vẫn còn trong DB để tra cứu lịch sử. Không thể dừng hóa đơn đã xuất.
 *     tags: [Admin - Contract Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Lý do dừng (lưu audit log + cancellationReason)
 *     responses:
 *       200:
 *         description: Đã dừng hóa đơn
 *       400:
 *         description: Hóa đơn không ở DRAFT hoặc đã bị dừng
 *       404:
 *         description: Không tìm thấy hóa đơn
 */
router.patch('/invoices/:invoiceId/cancel', protect, authorize('admin'), cancelDraftInvoice);

/**
 * @swagger
 * /api/admin/contracts/invoices/{invoiceId}/transition:
 *   patch:
 *     summary: Chuyển trạng thái hóa đơn (Admin)
 *     tags: [Contract - Invoices]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [ISSUED, DRAFT, PAID, CANCELLED]
 *                 description: Trạng thái mới
 *               reason:
 *                 type: string
 *                 description: Lý do (dùng khi hủy)
 *     responses:
 *       200:
 *         description: Đã chuyển trạng thái
 *       400:
 *         description: Bước chuyển không hợp lệ
 */
router.patch('/invoices/:invoiceId/transition', protect, authorize('admin'), transitionInvoiceStatus);

module.exports = router;

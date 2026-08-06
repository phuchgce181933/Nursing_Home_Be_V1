const express = require('express');
const router = express.Router();
const {
  createMedication,
  updateMedication,
  listMedications,
  getMedication,
  addMedicationNote,
  listMedicationNotes,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  listSuppliers,
  getSupplier,
  createStock,
  updateStock,
  listStocks,
  dispenseMedication,
  verifyPrescription,
  getLowStockAlerts,
  trackExpiry,
  getUsageStats,
  getReportSummary,
} = require('../controllers/pharmacyController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('pharmacist', 'admin'));

// Medication inventory
/**
 * @swagger
 * /api/pharmacy/medications:
 *   post:
 *     summary: Create medication inventory item
 *     tags: [Pharmacy - Medications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               medicationCode:
 *                 type: string
 *               name:
 *                 type: string
 *               form:
 *                 type: string
 *               strength:
 *                 type: string
 *               unit:
 *                 type: string
 *               manufacturer:
 *                 type: string
 *               description:
 *                 type: string
 *               minStockLevel:
 *                 type: number
 *     responses:
 *       201:
 *         description: Medication created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 */
router.post('/medications', createMedication);
/**
 * @swagger
 * /api/pharmacy/medications:
 *   get:
 *     summary: List medication inventory
 *     tags: [Pharmacy - Medications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
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
 *         description: Medication list
 */
router.get('/medications', listMedications);
/**
 * @swagger
 * /api/pharmacy/medications/{medicationId}:
 *   get:
 *     summary: Get medication detail
 *     tags: [Pharmacy - Medications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: medicationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Medication detail
 *       404:
 *         description: Not found
 */
router.get('/medications/:medicationId', getMedication);
/**
 * @swagger
 * /api/pharmacy/medications/{medicationId}:
 *   put:
 *     summary: Update medication
 *     tags: [Pharmacy - Medications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: medicationId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               form:
 *                 type: string
 *               strength:
 *                 type: string
 *               unit:
 *                 type: string
 *               manufacturer:
 *                 type: string
 *               description:
 *                 type: string
 *               minStockLevel:
 *                 type: number
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Medication updated
 *       404:
 *         description: Not found
 */
router.put('/medications/:medicationId', updateMedication);

// Medication notes
/**
 * @swagger
 * /api/pharmacy/medications/{medicationId}/notes:
 *   post:
 *     summary: Add medication note
 *     tags: [Pharmacy - Medication Notes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: medicationId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [note]
 *             properties:
 *               note:
 *                 type: string
 *     responses:
 *       201:
 *         description: Note created
 */
router.post('/medications/:medicationId/notes', addMedicationNote);
/**
 * @swagger
 * /api/pharmacy/medications/{medicationId}/notes:
 *   get:
 *     summary: List medication notes
 *     tags: [Pharmacy - Medication Notes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: medicationId
 *         required: true
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
 *         description: Note list
 */
router.get('/medications/:medicationId/notes', listMedicationNotes);

// Suppliers
/**
 * @swagger
 * /api/pharmacy/suppliers:
 *   post:
 *     summary: Create supplier
 *     tags: [Pharmacy - Suppliers]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               contactName:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               address:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Supplier created
 */
router.post('/suppliers', createSupplier);
/**
 * @swagger
 * /api/pharmacy/suppliers:
 *   get:
 *     summary: List suppliers
 *     tags: [Pharmacy - Suppliers]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
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
 *         description: Supplier list
 */
router.get('/suppliers', listSuppliers);
/**
 * @swagger
 * /api/pharmacy/suppliers/{supplierId}:
 *   get:
 *     summary: Get supplier detail
 *     tags: [Pharmacy - Suppliers]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: supplierId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Supplier detail
 *       404:
 *         description: Not found
 */
router.get('/suppliers/:supplierId', getSupplier);
/**
 * @swagger
 * /api/pharmacy/suppliers/{supplierId}:
 *   put:
 *     summary: Update supplier
 *     tags: [Pharmacy - Suppliers]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: supplierId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               contactName:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               address:
 *                 type: string
 *               notes:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Supplier updated
 *       404:
 *         description: Not found
 */
router.put('/suppliers/:supplierId', updateSupplier);
/**
 * @swagger
 * /api/pharmacy/suppliers/{supplierId}:
 *   delete:
 *     summary: Deactivate supplier
 *     tags: [Pharmacy - Suppliers]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: supplierId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Supplier deactivated
 */
router.delete('/suppliers/:supplierId', deleteSupplier);

// Stock management
/**
 * @swagger
 * /api/pharmacy/stocks:
 *   post:
 *     summary: Receive medication stock
 *     tags: [Pharmacy - Stock]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [medicationId, quantity]
 *             properties:
 *               medicationId:
 *                 type: string
 *               supplierId:
 *                 type: string
 *               quantity:
 *                 type: number
 *               unit:
 *                 type: string
 *               lotNumber:
 *                 type: string
 *               expiryDate:
 *                 type: string
 *                 format: date-time
 *               receivedDate:
 *                 type: string
 *                 format: date-time
 *               costPerUnit:
 *                 type: number
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Stock received
 */
router.post('/stocks', createStock);
/**
 * @swagger
 * /api/pharmacy/stocks:
 *   get:
 *     summary: List stock entries
 *     tags: [Pharmacy - Stock]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: medicationId
 *         schema:
 *           type: string
 *       - in: query
 *         name: supplierId
 *         schema:
 *           type: string
 *       - in: query
 *         name: lotNumber
 *         schema:
 *           type: string
 *       - in: query
 *         name: expiryFrom
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: expiryTo
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
 *         description: Stock list
 */
router.get('/stocks', listStocks);
/**
 * @swagger
 * /api/pharmacy/stocks/{stockId}:
 *   put:
 *     summary: Update stock entry
 *     tags: [Pharmacy - Stock]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stockId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               quantity:
 *                 type: number
 *               unit:
 *                 type: string
 *               lotNumber:
 *                 type: string
 *               expiryDate:
 *                 type: string
 *                 format: date-time
 *               receivedDate:
 *                 type: string
 *                 format: date-time
 *               costPerUnit:
 *                 type: number
 *               notes:
 *                 type: string
 *               supplierId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Stock updated
 */
router.put('/stocks/:stockId', updateStock);

// Dispense and verify
/**
 * @swagger
 * /api/pharmacy/dispenses:
 *   post:
 *     summary: Dispense medication
 *     tags: [Pharmacy - Dispense]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [medicationId, quantity]
 *             properties:
 *               medicationId:
 *                 type: string
 *               prescriptionId:
 *                 type: string
 *               residentId:
 *                 type: string
 *               quantity:
 *                 type: number
 *               dispensedAt:
 *                 type: string
 *                 format: date-time
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Medication dispensed
 */
router.post('/dispenses', dispenseMedication);
/**
 * @swagger
 * /api/pharmacy/prescriptions/{prescriptionId}/verify:
 *   patch:
 *     summary: Verify prescription
 *     tags: [Pharmacy - Prescriptions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: prescriptionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Prescription verified
 *       404:
 *         description: Not found
 */
router.patch('/prescriptions/:prescriptionId/verify', verifyPrescription);

// Alerts, expiry, stats, reports
/**
 * @swagger
 * /api/pharmacy/alerts/low-stock:
 *   get:
 *     summary: Low stock alerts
 *     tags: [Pharmacy - Alerts]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Low stock list
 */
router.get('/alerts/low-stock', getLowStockAlerts);
/**
 * @swagger
 * /api/pharmacy/expiry:
 *   get:
 *     summary: Track medication expiry
 *     tags: [Pharmacy - Stock]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: withinDays
 *         schema:
 *           type: integer
 *           default: 365
 *     responses:
 *       200:
 *         description: Expiring stock list
 */
router.get('/expiry', trackExpiry);
/**
 * @swagger
 * /api/pharmacy/stats/usage:
 *   get:
 *     summary: Medication usage statistics
 *     tags: [Pharmacy - Reports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
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
 *         description: Usage stats
 */
router.get('/stats/usage', getUsageStats);
/**
 * @swagger
 * /api/pharmacy/reports/summary:
 *   get:
 *     summary: Pharmacy report summary
 *     tags: [Pharmacy - Reports]
 *     security:
 *       - BearerAuth: []
 *     parameters:
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
 *         description: Report summary
 */
router.get('/reports/summary', getReportSummary);

module.exports = router;

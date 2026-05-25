const express = require('express');
const router = express.Router();
const {
  createServicePackage,
  updateServicePackage,
  deleteServicePackage,
  listServicePackages,
  getServicePackage,
} = require('../controllers/servicePackageController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('admin', 'manager'));

/**
 * @swagger
 * /api/admin/service-packages:
 *   post:
 *     summary: Create a new service package (UC-6.20)
 *     tags: [Admin - Service Package Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Name of the service package
 *               description:
 *                 type: string
 *               tier:
 *                 type: string
 *                 enum: [basic, standard, premium, vip]
 *                 default: standard
 *               services:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: List of included services
 *               monthlyPrice:
 *                 type: number
 *                 description: Monthly price in VND
 *     responses:
 *       201:
 *         description: Service package created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 */
router.post('/', createServicePackage);

/**
 * @swagger
 * /api/admin/service-packages:
 *   get:
 *     summary: List all service packages (UC-6.23)
 *     tags: [Admin - Service Package Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: tier
 *         schema:
 *           type: string
 *           enum: [basic, standard, premium, vip]
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name, packageCode, or description
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
 *         description: Paginated list of service packages
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 */
router.get('/', listServicePackages);

/**
 * @swagger
 * /api/admin/service-packages/{packageId}:
 *   get:
 *     summary: Get service package detail (UC-6.27)
 *     tags: [Admin - Service Package Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Service package detail
 *       404:
 *         description: Not found
 */
router.get('/:packageId', getServicePackage);

/**
 * @swagger
 * /api/admin/service-packages/{packageId}:
 *   put:
 *     summary: Update a service package (UC-6.21)
 *     tags: [Admin - Service Package Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: packageId
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
 *               description:
 *                 type: string
 *               tier:
 *                 type: string
 *                 enum: [basic, standard, premium, vip]
 *               services:
 *                 type: array
 *                 items:
 *                   type: string
 *               monthlyPrice:
 *                 type: number
 *     responses:
 *       200:
 *         description: Service package updated successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Not found
 */
router.put('/:packageId', updateServicePackage);

/**
 * @swagger
 * /api/admin/service-packages/{packageId}:
 *   delete:
 *     summary: Soft delete a service package (UC-6.22)
 *     tags: [Admin - Service Package Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Service package soft deleted (isActive = false)
 *       400:
 *         description: Already deleted
 *       404:
 *         description: Not found
 */
router.delete('/:packageId', deleteServicePackage);

module.exports = router;

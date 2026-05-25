const express = require('express');
const router = express.Router();
const {
  listServicePackages,
  getServicePackage,
} = require('../controllers/servicePackageController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('doctor', 'nurse', 'admin', 'manager', 'family'));

/**
 * @swagger
 * /api/medical/service-packages:
 *   get:
 *     summary: List active service packages (UC-6.23)
 *     tags: [Medical - Service Package]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: tier
 *         schema:
 *           type: string
 *           enum: [basic, standard, premium, vip]
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
 *         description: Paginated list of active service packages
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Access forbidden
 */
router.get('/', listServicePackages);

/**
 * @swagger
 * /api/medical/service-packages/{packageId}:
 *   get:
 *     summary: Get service package detail (UC-6.27)
 *     tags: [Medical - Service Package]
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

module.exports = router;

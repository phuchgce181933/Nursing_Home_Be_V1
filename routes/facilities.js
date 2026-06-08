const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/facilityController');
const { protect } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   name: Facilities
 *   description: Buildings, floors, and rooms for staff area assignment (PUT /api/staff/{id}/areas)
 */

/**
 * @swagger
 * /api/facilities/buildings:
 *   get:
 *     tags: [Facilities]
 *     summary: List buildings
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: activeOnly
 *         schema: { type: boolean, default: true }
 *     responses:
 *       200: { description: List of buildings }
 */
router.get('/buildings', protect, ctrl.listBuildings);

/**
 * @swagger
 * /api/facilities/floors:
 *   get:
 *     tags: [Facilities]
 *     summary: List floors (for staff area assignment dropdown)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: buildingId
 *         schema: { type: string }
 *         description: Filter floors by building
 *       - in: query
 *         name: activeOnly
 *         schema: { type: boolean, default: true }
 *     responses:
 *       200:
 *         description: Floors with label for UI (e.g. "Tầng 1 — Tòa chính")
 */
router.get('/floors', protect, ctrl.listFloors);

/**
 * @swagger
 * /api/facilities/floors/{floorId}/rooms:
 *   get:
 *     tags: [Facilities]
 *     summary: List rooms on a floor (staff responsibleRoomIds)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: floorId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Rooms on the floor }
 */
router.get('/floors/:floorId/rooms', protect, ctrl.listRoomsByFloor);

/**
 * @swagger
 * /api/facilities/floors/{floorId}:
 *   get:
 *     tags: [Facilities]
 *     summary: Get one floor by ID
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: floorId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Floor detail }
 *       404: { description: Not found }
 */
router.get('/floors/:floorId', protect, ctrl.getFloor);

router.get('/rooms/:roomId/beds', protect, ctrl.listAvailableBedsByRoom);

module.exports = router;

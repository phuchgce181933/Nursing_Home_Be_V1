const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/facilityController');
const { protect, authorize } = require('../middleware/auth');
const adminManager = authorize('admin');

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
router.get('/stats', protect, ctrl.getStats);

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

router.post('/buildings', protect, adminManager, ctrl.createBuilding);
router.put('/buildings/:id', protect, adminManager, ctrl.updateBuilding);
router.delete('/buildings/:id', protect, adminManager, ctrl.deleteBuilding);
router.get('/buildings/:id/stats', protect, ctrl.getBuildingStats);

router.post('/floors', protect, adminManager, ctrl.createFloor);
router.put('/floors/:id', protect, adminManager, ctrl.updateFloor);
router.delete('/floors/:id', protect, adminManager, ctrl.deleteFloor);
router.post('/rooms', protect, adminManager, ctrl.createRoom);
router.put('/rooms/:id', protect, adminManager, ctrl.updateRoom);
router.delete('/rooms/:id', protect, adminManager, ctrl.deleteRoom);

router.post('/beds', protect, adminManager, ctrl.createBed);
router.put('/beds/:id', protect, adminManager, ctrl.updateBed);
router.delete('/beds/:id', protect, adminManager, ctrl.deleteBed);

router.get('/equipment', protect, ctrl.listEquipment);
router.post('/equipment', protect, adminManager, ctrl.createEquipment);
router.put('/equipment/:id', protect, adminManager, ctrl.updateEquipment);
router.delete('/equipment/:id', protect, adminManager, ctrl.deleteEquipment);

module.exports = router;

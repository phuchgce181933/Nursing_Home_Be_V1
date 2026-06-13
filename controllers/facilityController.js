const svc = require('../services/facilityService');

const respond = (res, promise) =>
  promise
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(err.status || 500).json({ success: false, message: err.message }));

const listBuildings = (req, res) =>
  respond(res, svc.listBuildings({ activeOnly: req.query.activeOnly !== 'false' }));

const listFloors = (req, res) =>
  respond(
    res,
    svc.listFloors({
      buildingId: req.query.buildingId,
      activeOnly: req.query.activeOnly !== 'false',
    })
  );

const getFloor = (req, res) => respond(res, svc.getFloor(req.params.floorId));

const listRoomsByFloor = (req, res) => respond(res, svc.listRoomsByFloor(req.params.floorId));

const listAvailableBedsByRoom = (req, res) => respond(res, svc.listAvailableBedsByRoom(req.params.roomId, { all: req.query.all === 'true' }));

const createBuilding = (req, res) => respond(res, svc.createBuilding(req.body, req.user, req));

const updateBuilding = (req, res) => respond(res, svc.updateBuilding(req.params.id, req.body, req.user, req));

const deleteBuilding = (req, res) => respond(res, svc.deleteBuilding(req.params.id, req.user, req));

const createFloor = (req, res) => respond(res, svc.createFloor(req.body, req.user, req));

const updateFloor = (req, res) => respond(res, svc.updateFloor(req.params.id, req.body, req.user, req));

const deleteFloor = (req, res) => respond(res, svc.deleteFloor(req.params.id, req.user, req));

const createRoom = (req, res) => respond(res, svc.createRoom(req.body, req.user, req));

const updateRoom = (req, res) => respond(res, svc.updateRoom(req.params.id, req.body, req.user, req));

const deleteRoom = (req, res) => respond(res, svc.deleteRoom(req.params.id, req.user, req));

const createBed = (req, res) => respond(res, svc.createBed(req.body, req.user, req));

const updateBed = (req, res) => respond(res, svc.updateBed(req.params.id, req.body, req.user, req));

const deleteBed = (req, res) => respond(res, svc.deleteBed(req.params.id, req.user, req));

const listEquipment = (req, res) =>
  respond(
    res,
    svc.listEquipment({
      status: req.query.status,
      category: req.query.category,
      roomId: req.query.roomId,
    })
  );

const createEquipment = (req, res) => respond(res, svc.createEquipment(req.body, req.user, req));

const updateEquipment = (req, res) => respond(res, svc.updateEquipment(req.params.id, req.body, req.user, req));

const deleteEquipment = (req, res) => respond(res, svc.deleteEquipment(req.params.id, req.user, req));

module.exports = {
  listBuildings,
  listFloors,
  getFloor,
  listRoomsByFloor,
  listAvailableBedsByRoom,
  createBuilding,
  updateBuilding,
  deleteBuilding,
  createFloor,
  updateFloor,
  deleteFloor,
  createRoom,
  updateRoom,
  deleteRoom,
  createBed,
  updateBed,
  deleteBed,
  listEquipment,
  createEquipment,
  updateEquipment,
  deleteEquipment,
};

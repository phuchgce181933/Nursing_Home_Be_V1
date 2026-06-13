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

const listAvailableBedsByRoom = (req, res) => respond(res, svc.listAvailableBedsByRoom(req.params.roomId));

const createBuilding = (req, res) => respond(res, svc.createBuilding(req.body, req.user, req));

const updateBuilding = (req, res) => respond(res, svc.updateBuilding(req.params.id, req.body, req.user, req));

const deleteBuilding = (req, res) => respond(res, svc.deleteBuilding(req.params.id, req.user, req));

module.exports = {
  listBuildings,
  listFloors,
  getFloor,
  listRoomsByFloor,
  listAvailableBedsByRoom,
  createBuilding,
  updateBuilding,
  deleteBuilding,
};

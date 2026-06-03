const svc = require('../services/assignedResidentService');

const statusCode = (err) => err.statusCode || err.status || 500;

const listResidents = (req, res) =>
  svc
    .listAssignedResidentsForUser(req.user._id, { search: req.query.search })
    .then((result) =>
      res.json({
        success: true,
        data: result.data,
        total: result.total,
        message: result.message,
      })
    )
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const getResident = (req, res) =>
  svc
    .getAssignedResidentById(req.user._id, req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

module.exports = {
  listResidents,
  getResident,
};

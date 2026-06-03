const svc = require('../services/caregiverCareTaskService');

const statusCode = (err) => err.statusCode || err.status || 500;

const listTasks = (req, res) =>
  svc
    .listMyCareTasks(req.user._id, req.query)
    .then((result) =>
      res.json({
        success: true,
        data: result.data,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      })
    )
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const getTask = (req, res) =>
  svc
    .getMyCareTask(req.user._id, req.params.id)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

const updateStatus = (req, res) =>
  svc
    .updateMyCareTaskStatus(req.user._id, req.params.id, req.body)
    .then((data) => res.json({ success: true, data, message: 'Cập nhật trạng thái thành công' }))
    .catch((err) => res.status(statusCode(err)).json({ success: false, message: err.message }));

module.exports = {
  listTasks,
  getTask,
  updateStatus,
};

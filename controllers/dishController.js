const svc = require('../services/dishService');
const { sendApiError } = require('../utils/apiErrorResponse');

const listDishes = (req, res) =>
  svc
    .listDishes(req.query, req.user)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const getDish = (req, res) =>
  svc
    .getDish(req.params.id, req.user)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const createDish = (req, res) =>
  svc
    .createDish(req.body, req.user)
    .then((data) => res.status(201).json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const updateDish = (req, res) =>
  svc
    .updateDish(req.params.id, req.body, req.user)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

const deleteDish = (req, res) =>
  svc
    .deleteDish(req.params.id, req.user)
    .then((data) => res.json({ success: true, data }))
    .catch((err) => sendApiError(res, err));

module.exports = {
  listDishes,
  getDish,
  createDish,
  updateDish,
  deleteDish,
};

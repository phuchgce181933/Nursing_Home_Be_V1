const Dish = require('../models/dish');

const create = async (data) => Dish.create(data);

const findById = async (id) => Dish.findById(id);

const findByIdLean = async (id) => Dish.findById(id).lean();

const findOneLean = async (filter) => Dish.findOne(filter).lean();

const findByFilterLean = async (filter, { sort } = {}) => {
  let q = Dish.find(filter);
  if (sort) q = q.sort(sort);
  return q.lean();
};

const findByIdAndUpdate = async (id, update, opts = {}) =>
  Dish.findByIdAndUpdate(id, update, opts);

const findByIdAndDelete = async (id) => Dish.findByIdAndDelete(id);

const saveDoc = async (doc) => doc.save();

module.exports = {
  create,
  findById,
  findByIdLean,
  findOneLean,
  findByFilterLean,
  findByIdAndUpdate,
  findByIdAndDelete,
  saveDoc,
};

const Building = require('../models/building');

const findByFilterLean = async (filter, { select, sort } = {}) => {
  let q = Building.find(filter);
  if (select) q = q.select(select);
  if (sort) q = q.sort(sort);
  return q.lean();
};
const findOne = async (filter) => Building.findOne(filter);
const findById = async (id) => Building.findById(id);
const findByIdLean = async (id) => Building.findById(id).lean();
const create = async (data) => Building.create(data);
const countDocuments = async (filter) => Building.countDocuments(filter);

module.exports = { findByFilterLean, findOne, findById, findByIdLean, create, countDocuments };

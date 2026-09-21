const Equipment = require('../models/equipment');

const POPULATES = [
  { path: 'buildingId', select: 'name code' },
  { path: 'floorId', select: 'name floorNumber' },
  { path: 'roomId', select: 'roomNumber' },
  { path: 'bedId', select: 'bedCode' },
];

const findByFilterPopulated = async (filter, { sort } = {}) => {
  let q = Equipment.find(filter);
  for (const p of POPULATES) q = q.populate(p);
  if (sort) q = q.sort(sort);
  return q.lean();
};

const findByFilterPopulatedPaginated = async (filter, { sort, skip, limit } = {}) => {
  let q = Equipment.find(filter);
  for (const p of POPULATES) q = q.populate(p);
  if (sort) q = q.sort(sort);
  if (skip != null) q = q.skip(skip);
  if (limit != null) q = q.limit(limit);
  return q.lean();
};

const countByFilter = async (filter) => Equipment.countDocuments(filter);

const findOne = async (filter) => Equipment.findOne(filter);
const findById = async (id) => Equipment.findById(id);
const create = async (data) => Equipment.create(data);
const findByIdAndDelete = async (id) => Equipment.findByIdAndDelete(id);

module.exports = { findByFilterPopulated, findByFilterPopulatedPaginated, countByFilter, findOne, findById, create, findByIdAndDelete };

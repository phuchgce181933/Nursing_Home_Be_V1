const Floor = require('../models/floor');

const BUILDING_POPULATE = { path: 'buildingId', select: 'code name address isActive' };

const findAll = async (filter = {}, options = {}) => {
  const query = Floor.find(filter).populate(BUILDING_POPULATE).sort({ floorNumber: 1 });
  if (options.select) query.select(options.select);
  return query.lean();
};

const findById = async (id) => Floor.findById(id).populate(BUILDING_POPULATE);

const findByBuildingId = async (buildingId, { activeOnly = true } = {}) => {
  const filter = { buildingId };
  if (activeOnly) filter.isActive = { $ne: false };
  return findAll(filter);
};

const findByFilter = async (filter) => Floor.find(filter);
const findOne = async (filter) => Floor.findOne(filter);
const create = async (data) => Floor.create(data);
const updateMany = async (filter, update) => Floor.updateMany(filter, update);
const countDocuments = async (filter) => Floor.countDocuments(filter);

module.exports = {
  findAll,
  findById,
  findByBuildingId,
  findByFilter,
  findOne,
  create,
  updateMany,
  countDocuments,
};

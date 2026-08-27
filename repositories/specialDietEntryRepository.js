const SpecialDietEntry = require('../models/specialDietEntry');

const POPULATE = [
  { path: 'residentId', select: 'fullName residentCode allergies chronicConditions roomId', populate: { path: 'roomId', select: 'roomNumber' } },
];

const createMany = async (rows, options = {}) => SpecialDietEntry.insertMany(rows, options);

const findByDayId = async (specialDietDayId) =>
  SpecialDietEntry.find({ specialDietDayId }).populate(POPULATE).sort({ effectiveTime: 1, createdAt: 1 });

const deleteByDayId = async (specialDietDayId, options = {}) =>
  SpecialDietEntry.deleteMany({ specialDietDayId }, options);

const findByFilterLean = async (filter, { populate, select } = {}) => {
  let q = SpecialDietEntry.find(filter);
  if (select) q = q.select(select);
  if (populate) q = q.populate(populate);
  return q.lean();
};

module.exports = {
  createMany,
  findByDayId,
  deleteByDayId,
  findByFilterLean,
};

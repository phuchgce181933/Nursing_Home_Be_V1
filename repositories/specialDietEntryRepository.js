const SpecialDietEntry = require('../models/specialDietEntry');

const POPULATE = [
  { path: 'residentId', select: 'fullName residentCode allergies chronicConditions roomId', populate: { path: 'roomId', select: 'roomNumber' } },
];

const createMany = async (rows, options = {}) => SpecialDietEntry.insertMany(rows, options);

const findByDayId = async (specialDietDayId) =>
  SpecialDietEntry.find({ specialDietDayId }).populate(POPULATE).sort({ effectiveTime: 1, createdAt: 1 });

const deleteByDayId = async (specialDietDayId, options = {}) =>
  SpecialDietEntry.deleteMany({ specialDietDayId }, options);

module.exports = {
  createMany,
  findByDayId,
  deleteByDayId,
};

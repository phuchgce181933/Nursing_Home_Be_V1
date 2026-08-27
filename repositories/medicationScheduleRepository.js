const MedicationSchedule = require('../models/MedicationSchedule');

const create = (data) => MedicationSchedule.create(data);
const insertMany = (docs) => MedicationSchedule.insertMany(docs);

const findById = (id) => MedicationSchedule.findById(id);

const findByFilter = (filter, { sort, populate } = {}) => {
  let query = MedicationSchedule.find(filter);
  if (populate) {
    for (const p of Array.isArray(populate) ? populate : [populate]) {
      query = query.populate(p);
    }
  }
  if (sort) query = query.sort(sort);
  return query;
};

const countByFilter = (filter) => MedicationSchedule.countDocuments(filter);

const updateManyByFilter = (filter, update) =>
  MedicationSchedule.updateMany(filter, update);

const deleteManyByFilter = (filter) =>
  MedicationSchedule.deleteMany(filter);

const saveDoc = (doc) => doc.save();

module.exports = {
  create,
  insertMany,
  findById,
  findByFilter,
  countByFilter,
  updateManyByFilter,
  deleteManyByFilter,
  saveDoc,
};

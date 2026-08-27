const ClinicalService = require('../models/clinicalService');

const create = (data) => ClinicalService.create(data);

const findById = (id) => ClinicalService.findById(id);

const findAll = (filter) => ClinicalService.find(filter).lean();

const countAll = (filter) => ClinicalService.countDocuments(filter);

const findOne = (filter) => ClinicalService.findOne(filter);
const findOneLean = (filter) => ClinicalService.findOne(filter).lean();

const saveDoc = (doc) => doc.save();

module.exports = {
  create,
  findById,
  findAll,
  countAll,
  findOne,
  findOneLean,
  saveDoc,
};

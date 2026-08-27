const DrugInteraction = require('../models/DrugInteraction');

const findByFilter = async (filter) => DrugInteraction.find(filter);

module.exports = { findByFilter };

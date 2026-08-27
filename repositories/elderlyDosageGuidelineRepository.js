const ElderlyDosageGuideline = require('../models/ElderlyDosageGuideline');

const findByFilter = async (filter) => ElderlyDosageGuideline.find(filter);

module.exports = { findByFilter };

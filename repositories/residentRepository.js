const Resident = require('../models/resident');

const findById = async (id) => Resident.findById(id);

module.exports = { findById };

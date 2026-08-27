const ContraindicationRule = require('../models/ContraindicationRule');

const findByFilter = async (filter) => ContraindicationRule.find(filter);

module.exports = { findByFilter };

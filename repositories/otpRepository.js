const Otp = require('../models/otp');

const findByFilter = async (filter) => Otp.find(filter);
const create = async (data) => Otp.create(data);
const deleteById = async (id) => Otp.deleteOne({ _id: id });
const findById = async (id) => Otp.findById(id);

module.exports = { findByFilter, create, deleteById, findById };

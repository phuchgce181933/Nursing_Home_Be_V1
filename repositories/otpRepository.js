const Otp = require('../models/otp');

const findByFilter = async (filter, options = {}) => {
  let query = Otp.find(filter);
  if (options.sort) query = query.sort(options.sort);
  return query;
};
const create = async (data) => Otp.create(data);
const deleteById = async (id) => Otp.deleteOne({ _id: id });
const findById = async (id) => Otp.findById(id);

module.exports = { findByFilter, create, deleteById, findById };

const ShiftTemplate = require('../models/shiftTemplate');

const findAll = async (filter = {}) => ShiftTemplate.find(filter).populate('department', 'floorNumber name').sort({ name: 1 });
const findById = async (id) => ShiftTemplate.findById(id).populate('department', 'floorNumber name').populate('createdBy', 'fullName');
const findByName = async (name) => ShiftTemplate.findOne({ name });
const findByShiftCode = async (shiftCode) => ShiftTemplate.findOne({ shiftCode: shiftCode.toUpperCase() });
const findByNameAndDepartment = async (name, department) => ShiftTemplate.findOne({ name, department: department || null });
const create = async (data) => ShiftTemplate.create(data);
const updateById = async (id, data) => ShiftTemplate.findByIdAndUpdate(id, data, { new: true, runValidators: true });
const deleteById = async (id) => ShiftTemplate.findByIdAndDelete(id);

module.exports = { findAll, findById, findByName, findByShiftCode, findByNameAndDepartment, create, updateById, deleteById };

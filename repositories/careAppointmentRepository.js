const CareAppointment = require('../models/careAppointment');

const populateAppointment = (query) =>
  query
    .populate('residentId', 'fullName residentCode')
    .populate({ path: 'doctorStaffId', populate: { path: 'userId', select: 'fullName' } })
    .populate({ path: 'nurseStaffId', populate: { path: 'userId', select: 'fullName' } });

const createAppointment = async (appointmentData) => CareAppointment.create(appointmentData);
const findById = async (id) => CareAppointment.findById(id);
const findByIdWithPopulate = async (id) => populateAppointment(CareAppointment.findById(id));

const findOneConflict = async (residentId, startAt, endAt, excludeId = null) => {
  const query = {
    residentId,
    status: { $ne: 'cancelled' },
    scheduledStartAt: { $lt: endAt },
    scheduledEndAt: { $gt: startAt },
  };
  if (excludeId) query._id = { $ne: excludeId };
  return CareAppointment.findOne(query);
};

const findAppointmentsWithPopulate = async (filter, { sort = { scheduledStartAt: -1 }, skip = 0, limit = 20 } = {}) =>
  populateAppointment(CareAppointment.find(filter).sort(sort).skip(skip).limit(limit));

const findAppointments = async (filter, { sort = { scheduledStartAt: -1 }, skip = 0, limit = 20 } = {}) =>
  CareAppointment.find(filter).sort(sort).skip(skip).limit(limit);

const countDocuments = async (filter) => CareAppointment.countDocuments(filter);

const saveAppointment = async (appointment) => appointment.save();
const deleteAppointment = async (appointment) => appointment.deleteOne();

module.exports = {
  createAppointment,
  findById,
  findByIdWithPopulate,
  findOneConflict,
  findAppointmentsWithPopulate,
  findAppointments,
  countDocuments,
  saveAppointment,
  deleteAppointment,
};

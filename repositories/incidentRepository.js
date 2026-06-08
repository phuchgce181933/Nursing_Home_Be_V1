const Incident = require('../models/incident');

const populateDetails = (query) =>
  query
    .populate('residentId', 'residentCode fullName')
    .populate({
      path: 'reportedByStaffId',
      select: 'staffCode specialty userId',
      populate: { path: 'userId', select: 'fullName email phone role' },
    })
    .populate({
      path: 'assignedStaffIds',
      select: 'staffCode specialty userId',
      populate: { path: 'userId', select: 'fullName email phone role' },
    });

const createIncident = async (data) => Incident.create(data);

const findById = async (id) => populateDetails(Incident.findById(id));

const findAll = async (filter, { sort, skip, limit } = {}) =>
  populateDetails(Incident.find(filter).sort(sort).skip(skip).limit(limit));

const countAll = async (filter) => Incident.countDocuments(filter);

const updateById = async (id, update) =>
  populateDetails(Incident.findByIdAndUpdate(id, update, { new: true, runValidators: true }));

module.exports = {
  createIncident,
  findById,
  findAll,
  countAll,
  updateById,
};

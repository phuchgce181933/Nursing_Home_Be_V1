const Resident = require('../models/resident');

const findById = async (id) => Resident.findById(id);

const findByResidentCode = async (residentCode) =>
	Resident.findOne({ residentCode: residentCode.toUpperCase().trim() });

const createResident = async (data) => Resident.create(data);

const findAll = async (filter, { sort, skip, limit }) =>
	Resident.find(filter)
		.select(
			'residentCode fullName dateOfBirth gender bloodType residencyStatus admittedAt roomId bedId familyPortalAccountIds'
		)
		.sort(sort)
		.skip(skip)
		.limit(limit)
		.populate('roomId', 'roomCode name')
		.populate('bedId', 'bedCode')
		.populate('familyPortalAccountIds', 'fullName email phone');

const countAll = async (filter) => Resident.countDocuments(filter);

const findByIdForAdmin = async (id) =>
	Resident.findById(id)
		.populate('roomId', 'roomCode name')
		.populate('bedId', 'bedCode')
		.populate('familyPortalAccountIds', 'fullName email phone');

const updateById = async (id, update) =>
	Resident.findByIdAndUpdate(id, update, { new: true, runValidators: true })
		.populate('roomId', 'roomCode name')
		.populate('bedId', 'bedCode')
		.populate('familyPortalAccountIds', 'fullName email phone');

module.exports = {
	findById,
	findByResidentCode,
	createResident,
	findAll,
	countAll,
	findByIdForAdmin,
	updateById,
};

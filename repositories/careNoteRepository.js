const CareNote = require('../models/careNote');

const populateNote = (query) =>
  query
    .populate('residentId', 'fullName residentCode')
    .populate({ path: 'authorStaffId', populate: { path: 'userId', select: 'fullName role' } });

const createNote = async (noteData) => CareNote.create(noteData);
const findById = async (id) => CareNote.findById(id);
const findByIdWithPopulate = async (id) => populateNote(CareNote.findById(id));

const findNotesWithPopulate = async (filter, { sort = { noteAt: -1 }, skip = 0, limit = 20 } = {}) =>
  populateNote(CareNote.find(filter).sort(sort).skip(skip).limit(limit));

const countDocuments = async (filter) => CareNote.countDocuments(filter);
const deleteNote = async (note) => note.deleteOne();
const saveNote = async (note) => note.save();

module.exports = {
  createNote,
  findById,
  findByIdWithPopulate,
  findNotesWithPopulate,
  countDocuments,
  deleteNote,
  saveNote,
};

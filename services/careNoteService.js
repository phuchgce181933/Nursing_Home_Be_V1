const ServiceError = require('./serviceError');
const careNoteRepo = require('../repositories/careNoteRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const { createAuditLog } = require('../utils/auditLog');

const VALID_NOTE_TYPES = ['meal', 'activity', 'health', 'general'];

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const createNote = async (user, body, req) => {
  const { residentId, noteType, content, noteAt } = body;
  if (!residentId) throw new ServiceError('residentId is required', 400);
  if (!content || content.trim().length < 5) {
    throw new ServiceError('content is required and must be at least 5 characters', 400);
  }
  if (noteType && !VALID_NOTE_TYPES.includes(noteType)) {
    throw new ServiceError(`noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}`, 400);
  }

  const staffProfile = await staffProfileRepo.findByUserId(user._id);
  if (!staffProfile) {
    throw new ServiceError('Staff profile not found for this account. Contact admin.', 400);
  }

  const note = await careNoteRepo.createNote({
    residentId,
    authorStaffId: staffProfile._id,
    noteType: noteType || 'general',
    content: content.trim(),
    noteAt: noteAt ? new Date(noteAt) : new Date(),
  });

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'CREATE',
    module: 'CareNote',
    targetEntityType: 'CareNote',
    targetEntityId: note._id,
    afterData: note.toObject(),
    req,
  });

  return careNoteRepo.findByIdWithPopulate(note._id);
};

const listNotes = async (query) => {
  const filter = {};
  if (query.residentId) filter.residentId = query.residentId;
  if (query.noteType) {
    if (!VALID_NOTE_TYPES.includes(query.noteType)) {
      throw new ServiceError(`noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}`, 400);
    }
    filter.noteType = query.noteType;
  }
  if (query.authorStaffId) filter.authorStaffId = query.authorStaffId;
  if (query.search) filter.content = { $regex: query.search.trim(), $options: 'i' };
  if (query.from || query.to) {
    filter.noteAt = {};
    if (query.from) filter.noteAt.$gte = new Date(query.from);
    if (query.to) filter.noteAt.$lte = new Date(query.to);
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    careNoteRepo.findNotesWithPopulate(filter, { sort: { noteAt: -1 }, skip, limit: limitNum }),
    careNoteRepo.countDocuments(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

const getNoteHistory = async (residentId, query) => {
  const filter = { residentId };
  if (query.noteType) filter.noteType = query.noteType;
  if (query.from || query.to) {
    filter.noteAt = {};
    if (query.from) filter.noteAt.$gte = new Date(query.from);
    if (query.to) filter.noteAt.$lte = new Date(query.to);
  }
  return careNoteRepo.findNotesWithPopulate(filter, { sort: { noteAt: -1 }, limit: 0 });
};

const getNote = async (id) => {
  const note = await careNoteRepo.findByIdWithPopulate(id);
  if (!note) throw new ServiceError('Care note not found', 404);
  return note;
};

const updateNote = async (user, id, body, req) => {
  const note = await careNoteRepo.findById(id);
  if (!note) throw new ServiceError('Care note not found', 404);

  if (body.content !== undefined && body.content.trim().length < 5) {
    throw new ServiceError('content must be at least 5 characters', 400);
  }
  if (body.noteType && !VALID_NOTE_TYPES.includes(body.noteType)) {
    throw new ServiceError(`noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}`, 400);
  }

  const before = note.toObject();
  if (body.noteType !== undefined) note.noteType = body.noteType;
  if (body.content !== undefined) note.content = body.content.trim();
  if (body.noteAt !== undefined) note.noteAt = new Date(body.noteAt);
  await careNoteRepo.saveNote(note);

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'UPDATE',
    module: 'CareNote',
    targetEntityType: 'CareNote',
    targetEntityId: note._id,
    beforeData: before,
    afterData: note.toObject(),
    req,
  });

  return careNoteRepo.findByIdWithPopulate(note._id);
};

const deleteNote = async (user, id, req) => {
  const note = await careNoteRepo.findById(id);
  if (!note) throw new ServiceError('Care note not found', 404);

  const before = note.toObject();
  await careNoteRepo.deleteNote(note);

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'DELETE',
    module: 'CareNote',
    targetEntityType: 'CareNote',
    targetEntityId: before._id,
    beforeData: before,
    req,
  });

  return { message: 'Care note deleted successfully' };
};

module.exports = { createNote, listNotes, getNoteHistory, getNote, updateNote, deleteNote };

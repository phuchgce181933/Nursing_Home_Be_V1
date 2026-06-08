const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const careNoteRepo = require('../repositories/careNoteRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const Resident = require('../models/resident');
const { createAuditLog } = require('../utils/auditLog');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const VALID_NOTE_TYPES = ['meal', 'activity', 'health', 'general'];

// Metadata enum values for structured note types
const VALID_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];
const VALID_INTAKE_AMOUNTS = ['none', 'little', 'half', 'most', 'all'];
const VALID_APPETITE = ['poor', 'fair', 'good', 'excellent'];

const VALID_ACTIVITY_TYPES = [
  'walking', 'exercise', 'physiotherapy', 'bathing', 'grooming',
  'reading', 'socializing', 'other',
];
const VALID_PARTICIPATION_LEVELS = ['refused', 'assisted', 'supervised', 'independent'];
const VALID_MOODS = ['happy', 'neutral', 'sad', 'agitated', 'anxious'];

const VALID_CONSCIOUSNESS = ['alert', 'confused', 'drowsy', 'unresponsive'];
const VALID_FALL_RISKS = ['low', 'medium', 'high'];

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const validateMetadata = (noteType, metadata) => {
  if (!metadata || typeof metadata !== 'object') return;

  if (noteType === 'meal') {
    if (metadata.mealType && !VALID_MEAL_TYPES.includes(metadata.mealType)) {
      throw new ServiceError(`mealType must be one of: ${VALID_MEAL_TYPES.join(', ')}`, 400);
    }
    if (metadata.intakeAmount && !VALID_INTAKE_AMOUNTS.includes(metadata.intakeAmount)) {
      throw new ServiceError(`intakeAmount must be one of: ${VALID_INTAKE_AMOUNTS.join(', ')}`, 400);
    }
    if (metadata.appetite && !VALID_APPETITE.includes(metadata.appetite)) {
      throw new ServiceError(`appetite must be one of: ${VALID_APPETITE.join(', ')}`, 400);
    }
  }

  if (noteType === 'activity') {
    if (metadata.activityType && !VALID_ACTIVITY_TYPES.includes(metadata.activityType)) {
      throw new ServiceError(`activityType must be one of: ${VALID_ACTIVITY_TYPES.join(', ')}`, 400);
    }
    if (metadata.participationLevel && !VALID_PARTICIPATION_LEVELS.includes(metadata.participationLevel)) {
      throw new ServiceError(`participationLevel must be one of: ${VALID_PARTICIPATION_LEVELS.join(', ')}`, 400);
    }
    if (metadata.mood && !VALID_MOODS.includes(metadata.mood)) {
      throw new ServiceError(`mood must be one of: ${VALID_MOODS.join(', ')}`, 400);
    }
    if (metadata.duration !== undefined) {
      const dur = Number(metadata.duration);
      if (!Number.isFinite(dur) || dur < 0) {
        throw new ServiceError('duration must be a non-negative number (minutes)', 400);
      }
    }
  }

  if (noteType === 'health') {
    if (metadata.consciousness && !VALID_CONSCIOUSNESS.includes(metadata.consciousness)) {
      throw new ServiceError(`consciousness must be one of: ${VALID_CONSCIOUSNESS.join(', ')}`, 400);
    }
    if (metadata.fallRisk && !VALID_FALL_RISKS.includes(metadata.fallRisk)) {
      throw new ServiceError(`fallRisk must be one of: ${VALID_FALL_RISKS.join(', ')}`, 400);
    }
    if (metadata.symptoms !== undefined && !Array.isArray(metadata.symptoms)) {
      throw new ServiceError('symptoms must be an array of strings', 400);
    }
  }
};

const createNote = async (user, body, req) => {
  const { residentId, noteType, content, noteAt, metadata } = body;
  if (!residentId) throw new ServiceError('residentId is required', 400);
  if (!isValidId(residentId)) throw new ServiceError('residentId is not a valid ID', 400);
  if (!content || content.trim().length < 5) {
    throw new ServiceError('content is required and must be at least 5 characters', 400);
  }
  if (noteType && !VALID_NOTE_TYPES.includes(noteType)) {
    throw new ServiceError(`noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}`, 400);
  }
  if (noteAt && new Date(noteAt) > new Date()) {
    throw new ServiceError('noteAt cannot be a future date', 400);
  }

  const resident = await Resident.findById(residentId).select('_id');
  if (!resident) throw new ServiceError('Resident not found', 404);

  const resolvedType = noteType || 'general';
  if (metadata) validateMetadata(resolvedType, metadata);

  const staffProfile = await staffProfileRepo.findByUserId(user._id);
  if (!staffProfile) {
    throw new ServiceError('Staff profile not found for this account. Contact admin.', 400);
  }

  const note = await careNoteRepo.createNote({
    residentId,
    authorStaffId: staffProfile._id,
    noteType: resolvedType,
    content: content.trim(),
    noteAt: noteAt ? new Date(noteAt) : new Date(),
    metadata: metadata || {},
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
  if (query.residentId) {
    if (!isValidId(query.residentId)) throw new ServiceError('residentId is not a valid ID', 400);
    filter.residentId = query.residentId;
  }
  if (query.noteType) {
    if (!VALID_NOTE_TYPES.includes(query.noteType)) {
      throw new ServiceError(`noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}`, 400);
    }
    filter.noteType = query.noteType;
  }
  if (query.authorStaffId) {
    if (!isValidId(query.authorStaffId)) throw new ServiceError('authorStaffId is not a valid ID', 400);
    filter.authorStaffId = query.authorStaffId;
  }
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
  if (!isValidId(residentId)) throw new ServiceError('residentId is not a valid ID', 400);
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
  if (!isValidId(id)) throw new ServiceError('Care note ID is not valid', 400);
  const note = await careNoteRepo.findByIdWithPopulate(id);
  if (!note) throw new ServiceError('Care note not found', 404);
  return note;
};

// Nurses can only update their own notes; doctor can update any note.
const updateNote = async (user, id, body, req) => {
  if (!isValidId(id)) throw new ServiceError('Care note ID is not valid', 400);

  const hasUpdate = body.content !== undefined || body.noteType !== undefined ||
    body.noteAt !== undefined || body.metadata !== undefined;
  if (!hasUpdate) throw new ServiceError('No fields provided to update', 400);

  const note = await careNoteRepo.findById(id);
  if (!note) throw new ServiceError('Care note not found', 404);

  if (user.role === 'nurse') {
    const staffProfile = await staffProfileRepo.findByUserId(user._id);
    if (!staffProfile || note.authorStaffId.toString() !== staffProfile._id.toString()) {
      throw new ServiceError('Nurses can only edit their own care notes', 403);
    }
  }

  if (body.content !== undefined && body.content.trim().length < 5) {
    throw new ServiceError('content must be at least 5 characters', 400);
  }
  if (body.noteType && !VALID_NOTE_TYPES.includes(body.noteType)) {
    throw new ServiceError(`noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}`, 400);
  }
  if (body.noteAt && new Date(body.noteAt) > new Date()) {
    throw new ServiceError('noteAt cannot be a future date', 400);
  }

  const resolvedType = body.noteType || note.noteType;
  if (body.metadata) validateMetadata(resolvedType, body.metadata);

  const before = note.toObject();
  if (body.noteType !== undefined) note.noteType = body.noteType;
  if (body.content !== undefined) note.content = body.content.trim();
  if (body.noteAt !== undefined) note.noteAt = new Date(body.noteAt);
  if (body.metadata !== undefined) {
    note.metadata = body.metadata;
    note.markModified('metadata');
  }
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

// Nurses can only delete their own notes; doctor can delete any note.
const deleteNote = async (user, id, req) => {
  if (!isValidId(id)) throw new ServiceError('Care note ID is not valid', 400);
  const note = await careNoteRepo.findById(id);
  if (!note) throw new ServiceError('Care note not found', 404);

  if (user.role === 'nurse') {
    const staffProfile = await staffProfileRepo.findByUserId(user._id);
    if (!staffProfile || note.authorStaffId.toString() !== staffProfile._id.toString()) {
      throw new ServiceError('Nurses can only delete their own care notes', 403);
    }
  }

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

// Returns paginated list of care notes written by the currently authenticated staff.
const getMyNotes = async (user, query) => {
  const staffProfile = await staffProfileRepo.findByUserId(user._id);
  if (!staffProfile) throw new ServiceError('Staff profile not found', 400);
  return listNotes({ ...query, authorStaffId: staffProfile._id.toString() });
};

module.exports = { createNote, listNotes, getNoteHistory, getNote, updateNote, deleteNote, getMyNotes };

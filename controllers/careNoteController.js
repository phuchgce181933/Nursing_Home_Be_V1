const careNoteService = require('../services/careNoteService');

const createNote = async (req, res) => {
  try {
    const result = await careNoteService.createNote(req.user, req.body, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listNotes = async (req, res) => {
  try {
    const result = await careNoteService.listNotes(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getNoteHistory = async (req, res) => {
  try {
    const result = await careNoteService.getNoteHistory(req.params.residentId, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getNote = async (req, res) => {
  try {
    const result = await careNoteService.getNote(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getNoteAuditHistory = async (req, res) => {
  try {
    const result = await careNoteService.getNoteAuditHistory(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const updateNote = async (req, res) => {
  try {
    const result = await careNoteService.updateNote(req.user, req.params.id, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const deleteNote = async (req, res) => {
  try {
    const result = await careNoteService.deleteNote(req.user, req.params.id, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getMyNotes = async (req, res) => {
  try {
    const result = await careNoteService.getMyNotes(req.user, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = { createNote, listNotes, getNoteHistory, getNote, getNoteAuditHistory, updateNote, deleteNote, getMyNotes };

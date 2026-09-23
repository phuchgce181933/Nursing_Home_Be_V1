const conversationService = require('../services/conversationService');

const sendError = (res, err) =>
  res.status(err.statusCode || 500).json({ message: err.message });

const emitIO = (req, event, data) => {
  try {
    const io = req.app && req.app.get && req.app.get('io');
    if (io) io.to(data.room).emit(event, data.payload);
  } catch (e) {}
};

const getCareTeam = async (req, res) => {
  try {
    const data = await conversationService.getCareTeam(req.user);
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const createConversation = async (req, res) => {
  try {
    const conversation = await conversationService.createConversation({ body: req.body, user: req.user, req });
    return res.status(201).json({ success: true, data: conversation });
  } catch (err) {
    return sendError(res, err);
  }
};

const getStaffDirectory = async (req, res) => {
  try {
    const data = await conversationService.getStaffDirectory(req.user._id);
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const createGuestConversation = async (req, res) => {
  try {
    const { conversation, message } = await conversationService.createGuestConversation({ body: req.body, req });
    try {
      const io = req.app && req.app.get && req.app.get('io');
      if (io) {
        io.to(`conversation:${String(conversation._id)}`).emit('conversation:guest_created', {
          conversationId: String(conversation._id), conversation, message,
        });
        io.to('role:admin').emit('notification:guest_conversation', {
          conversationId: String(conversation._id), conversation, message,
        });
      }
    } catch (e) {}
    return res.status(201).json({ success: true, data: { conversation, message } });
  } catch (err) {
    return sendError(res, err);
  }
};

const createGuestMessage = async (req, res) => {
  try {
    const { conversation, message } = await conversationService.createGuestMessage({
      conversationId: req.params.conversationId,
      body: req.body,
      req,
    });
    try {
      const io = req.app && req.app.get && req.app.get('io');
      if (io) {
        io.to(`conversation:${String(conversation._id)}`).emit('message:new', {
          conversationId: String(conversation._id), message,
        });
        io.to('role:admin').emit('notification:guest_message', {
          conversationId: String(conversation._id), message,
        });
      }
    } catch (e) {}
    return res.status(201).json({ success: true, data: message });
  } catch (err) {
    return sendError(res, err);
  }
};

const getGuestMessages = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50')));
    const data = await conversationService.getGuestMessages({ conversationId: req.params.conversationId, page, limit });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const createMessage = async (req, res) => {
  try {
    const { conversation, message } = await conversationService.createMessage({
      conversationId: req.params.conversationId,
      body: req.body,
      user: req.user,
      req,
    });
    try {
      const io = req.app && req.app.get && req.app.get('io');
      if (io) {
        io.to(`conversation:${String(conversation._id)}`).emit('message:new', {
          conversationId: String(conversation._id), message,
        });
      }
    } catch (e) {}
    return res.status(201).json({ success: true, data: message });
  } catch (err) {
    return sendError(res, err);
  }
};

const listConversations = async (req, res) => {
  try {
    const data = await conversationService.listConversations({ user: req.user });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const markMessagesRead = async (req, res) => {
  try {
    await conversationService.markMessagesRead({ conversationId: req.params.conversationId, user: req.user, req });
    return res.json({ success: true });
  } catch (err) {
    return sendError(res, err);
  }
};

const getConversationDetail = async (req, res) => {
  try {
    const data = await conversationService.getConversationDetail({ conversationId: req.params.conversationId, user: req.user });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const getMessages = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50')));
    const data = await conversationService.getMessages({
      conversationId: req.params.conversationId,
      user: req.user,
      page,
      limit,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const searchConversations = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const data = await conversationService.searchConversations({ user: req.user, q });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const searchMessages = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50')));
    const data = await conversationService.searchMessages({
      user: req.user,
      q,
      conversationId: req.query.conversationId,
      page,
      limit,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
};

const deleteConversation = async (req, res) => {
  try {
    const conversation = await conversationService.deleteConversation({
      conversationId: req.params.conversationId,
      user: req.user,
      req,
    });
    try {
      const io = req.app && req.app.get && req.app.get('io');
      if (io) {
        io.to('role:admin').emit('conversation:deleted', { conversationId: String(conversation._id) });
        io.to(`conversation:${String(conversation._id)}`).emit('conversation:deleted', { conversationId: String(conversation._id) });
      }
    } catch (e) {}
    return res.json({ success: true, message: 'Đã xóa cuộc trò chuyện' });
  } catch (err) {
    return sendError(res, err);
  }
};

module.exports = {
  createConversation,
  createMessage,
  createGuestConversation,
  createGuestMessage,
  getGuestMessages,
  getStaffDirectory,
  getCareTeam,
  listConversations,
  getConversationDetail,
  getMessages,
  deleteConversation,
  searchConversations,
  searchMessages,
  markMessagesRead,
};

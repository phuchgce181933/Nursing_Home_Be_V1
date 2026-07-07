const Conversation = require('../models/conversation');
const Message = require('../models/message');
const User = require('../models/user');
const guestMessageStore = require('../utils/guestMessageStore');

const createConversation = async (req, res) => {
  try {
    const { familyAccountId, participantUserIds = [], subject } = req.body;
    // family users: familyAccountId default to self
    const famId = req.user.role === 'family' ? req.user._id : familyAccountId;
    if (!famId) return res.status(400).json({ message: 'familyAccountId is required' });

    let conversation = await Conversation.findOne({ familyAccountId: famId, subject: subject || null });
    if (!conversation) {
      conversation = await Conversation.create({
        familyAccountId: famId,
        participantUserIds: Array.isArray(participantUserIds) ? participantUserIds : [],
        subject,
      });
    }

    return res.status(201).json({ success: true, data: conversation });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

// Create a guest conversation (no auth required)
const createGuestConversation = async (req, res) => {
  try {
    const { guestName, guestEmail, guestPhone, subject, content, attachments = [] } = req.body;
    if (!guestName) return res.status(400).json({ message: 'guestName is required' });
    if (!guestEmail && !guestPhone) return res.status(400).json({ message: 'guestEmail or guestPhone is required' });

    const conversation = await Conversation.create({
      isGuest: true,
      guestName,
      guestEmail,
      guestPhone,
      subject: subject || null,
    });

    let message = null;
    if (content && typeof content === 'string' && content.trim()) {
      // store guest message in-memory (temporary) instead of persisting to DB
      const msgObj = {
        conversationId: String(conversation._id),
        content: content.trim(),
        attachments: Array.isArray(attachments) ? attachments : [],
        guestName,
        guestEmail,
        guestPhone,
      };
      message = guestMessageStore.addMessage(conversation._id, msgObj);
      conversation.lastMessageAt = message.sentAt || new Date();
      await conversation.save();
    }

    // emit to staff/admin rooms if io exists (room: conversation:<id>)
    try {
      const io = req.app && req.app.get && req.app.get('io');
      if (io) {
        // notify any clients listening to this conversation room
        io.to(`conversation:${String(conversation._id)}`).emit('conversation:guest_created', {
          conversationId: String(conversation._id),
          conversation,
          message,
        });
        // also notify admin users specifically so only admins receive the initial guest notification
        io.to('role:admin').emit('notification:guest_conversation', {
          conversationId: String(conversation._id),
          conversation,
          message,
        });
      }
    } catch (e) {
      console.warn('Emit guest conversation event failed', e.message);
    }

    return res.status(201).json({ success: true, data: { conversation, message } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

// Guest can reply to an existing guest conversation (no auth)
const createGuestMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { content, attachments = [], guestName, guestEmail, guestPhone } = req.body;
    if (!content || typeof content !== 'string') return res.status(400).json({ message: 'content is required' });

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    if (!conversation.isGuest) return res.status(403).json({ message: 'Not a guest conversation' });

    // store guest message in-memory (temporary)
    const msgObj = {
      conversationId: String(conversation._id),
      content: content.trim(),
      attachments: Array.isArray(attachments) ? attachments : [],
      guestName: guestName || conversation.guestName,
      guestEmail: guestEmail || conversation.guestEmail,
      guestPhone: guestPhone || conversation.guestPhone,
    };
    const message = guestMessageStore.addMessage(conversation._id, msgObj);
    conversation.lastMessageAt = message.sentAt || new Date();
    await conversation.save();
    try {
      const io = req.app && req.app.get && req.app.get('io');
      if (io) {
        io.to(`conversation:${String(conversation._id)}`).emit('message:new', {
          conversationId: String(conversation._id),
          message,
        });
        // also send a notification to admins only (so admins get alerted)
        io.to('role:admin').emit('notification:guest_message', {
          conversationId: String(conversation._id),
          message,
        });
      }
    } catch (e) {
      console.warn('Emit guest message event failed', e.message);
    }
    

    return res.status(201).json({ success: true, data: message });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

// Public: get messages for a guest conversation
const getGuestMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50')));

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    if (!conversation.isGuest) return res.status(403).json({ message: 'Not a guest conversation' });

    // Merge messages persisted by staff (DB) with guest in-memory messages,
    // so staff replies are visible to the guest (mirrors getMessages below).
    const dbMsgs = await Message.find({ conversationId })
      .populate('senderUserId', 'fullName email role')
      .lean();
    const guestMsgs = guestMessageStore.getMessages(conversationId) || [];

    const normalize = (m) => ({
      _id: m._id,
      content: m.content,
      attachments: m.attachments || [],
      senderUserId: m.senderUserId || null,
      guestName: m.guestName,
      guestEmail: m.guestEmail,
      sentAt: m.sentAt || m.createdAt,
    });

    const all = [...dbMsgs.map(normalize), ...guestMsgs.map(normalize)];
    // sort by sentAt ascending (oldest first)
    all.sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt));
    // simple pagination
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);

    return res.json({ success: true, data: { items, page, limit, total: all.length } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

const createMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { content, attachments = [], participantUserIds = [] } = req.body;
    if (!content || typeof content !== 'string') return res.status(400).json({ message: 'content is required' });

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    // authorization: family can only post to their own conversations
    if (req.user.role === 'family' && String(conversation.familyAccountId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Access forbidden' });
    }

    const message = await Message.create({
      conversationId: conversation._id,
      senderUserId: req.user._id,
      content,
      attachments: Array.isArray(attachments) ? attachments : [],
    });

    // update conversation
    const participants = new Set([...(conversation.participantUserIds || []).map(String), String(req.user._id), ...(participantUserIds || []).map(String)]);
    conversation.participantUserIds = Array.from(participants);
    conversation.lastMessageAt = message.sentAt || message.createdAt || new Date();
    await conversation.save();

    // emit real-time event if Socket.IO is available
    try {
      const io = req.app && req.app.get && req.app.get('io');
      if (io) {
        io.to(`conversation:${String(conversation._id)}`).emit('message:new', {
          conversationId: String(conversation._id),
          message,
        });
      }
    } catch (e) {
      console.warn('Emit message event failed', e.message);
    }

    return res.status(201).json({ success: true, data: message });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

const listConversations = async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'family') {
      filter.familyAccountId = req.user._id;
    } else {
      // admin: show all conversations (to let admins see guest conversations)
      // other staff roles default to conversations where they are a participant
      if (req.user.role === 'admin') {
        filter = {};
      } else {
        filter.$or = [{ participantUserIds: req.user._id }];
      }
    }
    // residentId removed from conversation model; no resident filter

    const conversations = await Conversation.find(filter)
      .sort({ lastMessageAt: -1 })
      .populate('participantUserIds', 'fullName email role')
      .lean();

    return res.json({ success: true, data: conversations });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50')));

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    // authorization: family can only access their own conversations
    if (req.user.role === 'family' && String(conversation.familyAccountId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Access forbidden' });
    }

    // If this is a guest conversation, merge messages persisted by admins (DB)
    // with guest in-memory messages so admin replies are visible.
    if (conversation.isGuest) {
      const dbMsgs = await Message.find({ conversationId })
        .sort({ sentAt: -1 })
        .populate('senderUserId', 'fullName email role')
        .lean();

      const guestMsgs = guestMessageStore.getMessages(conversationId) || [];

      const normalize = (m) => ({
        _id: m._id,
        content: m.content,
        attachments: m.attachments || [],
        senderUserId: m.senderUserId || null,
        guestName: m.guestName,
        guestEmail: m.guestEmail,
        sentAt: m.sentAt || m.createdAt || m.sentAt,
      });

      const combined = [
        ...dbMsgs.map(normalize),
        ...guestMsgs.map(normalize),
      ];

      combined.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
      const total = combined.length;
      const start = (page - 1) * limit;
      const items = combined.slice(start, start + limit);
      return res.json({ success: true, data: { items, page, limit, total } });
    }

    const messages = await Message.find({ conversationId })
      .sort({ sentAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('senderUserId', 'fullName email role')
      .lean();

    return res.json({ success: true, data: { items: messages, page, limit } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

const searchConversations = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ message: 'q is required' });

    const regex = new RegExp(q, 'i');

    // Find conversations by subject
    let convFilter = { subject: { $regex: regex } };
    if (req.user.role === 'family') convFilter.familyAccountId = req.user._id;

    const convsBySubject = await Conversation.find(convFilter).lean();

    // Find messages containing q and then their conversations
    const msgFilter = { content: { $regex: regex } };
    if (req.user.role === 'family') {
      // restrict messages to conversations owned by this family
      const familyConvs = await Conversation.find({ familyAccountId: req.user._id }).select('_id');
      msgFilter.conversationId = { $in: familyConvs.map((c) => c._id) };
    }
    const msgs = await Message.find(msgFilter).select('conversationId').lean();
    const convIdsFromMsgs = msgs.map((m) => String(m.conversationId));

    const convs = convsBySubject.slice();
    if (convIdsFromMsgs.length) {
      const fromMsgs = await Conversation.find({ _id: { $in: convIdsFromMsgs } }).lean();
      // union unique by id
      const seen = new Set(convs.map((c) => String(c._id)));
      for (const c of fromMsgs) if (!seen.has(String(c._id))) convs.push(c);
    }

    return res.json({ success: true, data: convs });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

// Search messages globally or within a conversation
const searchMessages = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ message: 'q is required' });
    const conversationId = req.query.conversationId;
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50')));
    const regex = new RegExp(q, 'i');

    // if conversationId provided, restrict to that conversation
    if (conversationId) {
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
      if (req.user.role === 'family' && String(conversation.familyAccountId) !== String(req.user._id)) {
        return res.status(403).json({ message: 'Access forbidden' });
      }

      // search persisted messages
      const dbMsgs = await Message.find({ conversationId, content: { $regex: regex } })
        .sort({ sentAt: -1 })
        .populate('senderUserId', 'fullName email role')
        .lean();

      // include guest in-memory messages when relevant
      let guestMsgs = [];
      if (conversation.isGuest) {
        const all = guestMessageStore.getMessages(conversationId) || [];
        guestMsgs = all.filter((m) => regex.test(m.content)).map((m) => ({
          _id: m._id || null,
          conversationId: String(conversation._id),
          content: m.content,
          attachments: m.attachments || [],
          guestName: m.guestName,
          guestEmail: m.guestEmail,
          sentAt: m.sentAt,
          isGuest: true,
        }));
      }

      const combined = [...dbMsgs.map((m) => ({ ...m, isGuest: false })), ...guestMsgs];
      combined.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
      const total = combined.length;
      const start = (page - 1) * limit;
      const items = combined.slice(start, start + limit);
      return res.json({ success: true, data: { items, page, limit, total } });
    }

    // Global search: restrict by role
    const msgFilter = { content: { $regex: regex } };
    if (req.user.role === 'family') {
      // restrict messages to conversations owned by this family
      const familyConvs = await Conversation.find({ familyAccountId: req.user._id }).select('_id');
      msgFilter.conversationId = { $in: familyConvs.map((c) => c._id) };
    }

    // find persisted messages
    const dbMsgs = await Message.find(msgFilter)
      .sort({ sentAt: -1 })
      .limit(limit * 5)
      .populate('senderUserId', 'fullName email role')
      .lean();

    // include guest in-memory messages for guest conversations
    const guestResults = [];
    const guestConvs = await Conversation.find({ isGuest: true }).select('_id subject');
    for (const c of guestConvs) {
      if (req.user.role === 'family') {
        if (String(c.familyAccountId) !== String(req.user._id)) continue;
      }
      const all = guestMessageStore.getMessages(String(c._id)) || [];
      for (const m of all) {
        if (regex.test(m.content || '')) {
          guestResults.push({
            _id: m._id || null,
            conversationId: String(c._id),
            content: m.content,
            attachments: m.attachments || [],
            guestName: m.guestName,
            guestEmail: m.guestEmail,
            sentAt: m.sentAt,
            isGuest: true,
          });
        }
      }
    }

    const combined = [...dbMsgs.map((m) => ({ ...m, isGuest: false })), ...guestResults];
    combined.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    const total = combined.length;
    const start = (page - 1) * limit;
    const items = combined.slice(start, start + limit);
    return res.json({ success: true, data: { items, page, limit, total } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

// Delete a conversation (admin or owning family)
const deleteConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    // Only admin or owning family can delete
    if (req.user.role !== 'admin') {
      if (req.user.role === 'family') {
        if (String(conversation.familyAccountId) !== String(req.user._id)) {
          return res.status(403).json({ message: 'Access forbidden' });
        }
      } else {
        return res.status(403).json({ message: 'Access forbidden' });
      }
    }

    // delete persisted messages
    await Message.deleteMany({ conversationId: conversation._id });
    // clear guest in-memory messages
    try { guestMessageStore.clearConversation(conversationId); } catch (e) {}
    // remove conversation
    await Conversation.deleteOne({ _id: conversation._id });

    // emit deletion so clients can update
    try {
      const io = req.app && req.app.get && req.app.get('io');
      if (io) {
        io.to('role:admin').emit('conversation:deleted', { conversationId: String(conversation._id) });
        io.to(`conversation:${String(conversation._id)}`).emit('conversation:deleted', { conversationId: String(conversation._id) });
      }
    } catch (e) {}

    return res.json({ success: true, message: 'Conversation deleted' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createConversation,
  createMessage,
  createGuestConversation,
  createGuestMessage,
  getGuestMessages,
  listConversations,
  getMessages,
  deleteConversation,
  searchConversations,
  searchMessages,
};

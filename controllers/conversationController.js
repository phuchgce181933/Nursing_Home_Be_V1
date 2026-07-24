const Conversation = require('../models/conversation');
const Message = require('../models/message');
const User = require('../models/user');
const Resident = require('../models/resident');
const StaffProfile = require('../models/staffProfile');
const guestMessageStore = require('../utils/guestMessageStore');
const { validateEmail, validatePhone, escapeRegex } = require('../utils/validators');

// Whether `user` may read/post messages in `conversation`. Guest (public support) conversations
// are treated as a shared staff inbox — any authenticated non-family staff member may handle
// them, since a staff member isn't a participant until they first reply. Every other
// conversation requires admin, the owning family account, or actual participant membership.
const assertConversationAccess = (user, conversation) => {
  if (user.role === 'admin') return true;
  if (conversation.isGuest) return user.role !== 'family';
  if (user.role === 'family') return String(conversation.familyAccountId) === String(user._id);
  // participantUserIds may be raw ObjectIds or populated user docs — normalize either shape.
  const participantIds = (conversation.participantUserIds || []).map((p) => String(p && p._id ? p._id : p));
  return participantIds.includes(String(user._id));
};

// Mongo filter restricting a conversation-wide query (search, list) to what `user` is allowed
// to see: admins see everything, family sees only their own, other staff see conversations
// they participate in plus the shared guest inbox.
const buildConversationScopeFilter = (user) => {
  if (user.role === 'admin') return {};
  if (user.role === 'family') return { familyAccountId: user._id };
  return { $or: [{ participantUserIds: user._id }, { isGuest: true }] };
};

// The nurse(s)/doctor(s) currently responsible for a family's resident(s), derived from
// the standing StaffProfile.assignedResidentIds roster (Shift has no per-resident link,
// so on-duty schedule can't answer "who is assigned to resident X" — assignment is what
// the family portal's "care team" concept actually means here).
const getCareTeamForFamily = async (familyUserId) => {
  const residents = await Resident.find({ familyPortalAccountIds: familyUserId }).select('_id');
  const residentIds = residents.map((r) => r._id);
  if (!residentIds.length) return [];

  const profiles = await StaffProfile.find({ assignedResidentIds: { $in: residentIds } })
    .populate('userId', 'fullName email role isActive')
    .lean();

  const seen = new Set();
  const careTeam = [];
  for (const p of profiles) {
    const u = p.userId;
    if (!u || !u.isActive) continue;
    if (u.role !== 'nurse' && u.role !== 'doctor') continue;
    const id = String(u._id);
    if (seen.has(id)) continue;
    seen.add(id);
    careTeam.push({ _id: u._id, fullName: u.fullName, email: u.email, role: u.role });
  }
  return careTeam;
};

// Care team (assigned nurse/doctor) for the logged-in family user's resident(s) — used
// to populate the "message care staff" picker on the family side.
const getCareTeam = async (req, res) => {
  try {
    if (req.user.role !== 'family') return res.status(403).json({ message: 'Access forbidden' });
    const careTeam = await getCareTeamForFamily(req.user._id);
    return res.json({ success: true, data: careTeam });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

const createConversation = async (req, res) => {
  try {
    const { familyAccountId, participantUserIds = [], subject, targetUserId } = req.body;

    // family users: familyAccountId default to self. An optional targetUserId lets them
    // open a dedicated thread with a specific assigned nurse/doctor instead of the
    // general admin thread — validated against their actual care team below.
    if (req.user.role === 'family') {
      const famId = req.user._id;
      const findQuery = { familyAccountId: famId, subject: subject || null };
      if (targetUserId) findQuery.participantUserIds = { $all: [famId, targetUserId] };

      let conversation = await Conversation.findOne(findQuery);
      if (!conversation) {
        let resolvedTargetUserId = null;
        if (targetUserId) {
          const careTeam = await getCareTeamForFamily(famId);
          if (!careTeam.some((u) => String(u._id) === String(targetUserId))) {
            return res.status(403).json({ message: 'Nhân viên này không thuộc đội ngũ chăm sóc của bạn' });
          }
          resolvedTargetUserId = targetUserId;
        }
        conversation = await Conversation.create({
          familyAccountId: famId,
          participantUserIds: Array.from(
            new Set([
              String(famId),
              ...(resolvedTargetUserId ? [String(resolvedTargetUserId)] : []),
              ...(Array.isArray(participantUserIds) ? participantUserIds : []).map(String),
            ])
          ),
          subject,
        });
      }
      return res.status(201).json({ success: true, data: conversation });
    }

    // Staff direct conversation with a colleague (no family involved)
    if (targetUserId && !familyAccountId) {
      if (String(targetUserId) === String(req.user._id)) {
        return res.status(400).json({ message: 'targetUserId must be a different user' });
      }
      const targetUser = await User.findById(targetUserId).select('_id role');
      if (!targetUser) return res.status(404).json({ message: 'Target user not found' });

      let conversation = await Conversation.findOne({
        familyAccountId: null,
        participantUserIds: { $all: [req.user._id, targetUserId], $size: 2 },
      });
      if (!conversation) {
        conversation = await Conversation.create({
          familyAccountId: null,
          participantUserIds: [req.user._id, targetUserId],
          subject,
        });
      }
      return res.status(201).json({ success: true, data: conversation });
    }

    // Staff conversation about/with a specific family account
    if (!familyAccountId) return res.status(400).json({ message: 'familyAccountId or targetUserId is required' });

    let conversation = await Conversation.findOne({ familyAccountId, subject: subject || null });
    if (!conversation) {
      conversation = await Conversation.create({
        familyAccountId,
        participantUserIds: Array.from(new Set([String(req.user._id), ...(Array.isArray(participantUserIds) ? participantUserIds : []).map(String)])),
        subject,
      });
    }

    return res.status(201).json({ success: true, data: conversation });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};

// Directory of staff (non-family) users available to start a direct conversation with
const getStaffDirectory = async (req, res) => {
  try {
    const users = await User.find({ role: { $ne: 'family' }, isActive: true, _id: { $ne: req.user._id } })
      .select('fullName email role')
      .sort({ fullName: 1 })
      .lean();
    return res.json({ success: true, data: users });
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
    // guestEmail/guestPhone are alternatives (only one required above), so only check
    // format for whichever one was actually provided — mirrors the frontend widget's
    // validation to keep spam/garbage contacts from ever reaching the database.
    if (guestEmail) {
      const emailErr = validateEmail(guestEmail);
      if (emailErr) return res.status(400).json({ message: emailErr });
    }
    if (guestPhone) {
      const phoneErr = validatePhone(guestPhone);
      if (phoneErr) return res.status(400).json({ message: phoneErr });
    }

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
    const hasContent = typeof content === 'string' && content.trim().length > 0;
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    if (!hasContent && !hasAttachments) return res.status(400).json({ message: 'content or attachments is required' });

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    if (!conversation.isGuest) return res.status(403).json({ message: 'Not a guest conversation' });

    // store guest message in-memory (temporary)
    const msgObj = {
      conversationId: String(conversation._id),
      content: hasContent ? content.trim() : '',
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
    const hasContent = typeof content === 'string' && content.trim().length > 0;
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    if (!hasContent && !hasAttachments) return res.status(400).json({ message: 'content or attachments is required' });

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    if (!assertConversationAccess(req.user, conversation)) {
      return res.status(403).json({ message: 'Access forbidden' });
    }

    const message = await Message.create({
      conversationId: conversation._id,
      senderUserId: req.user._id,
      content: hasContent ? content.trim() : '',
      attachments: Array.isArray(attachments) ? attachments : [],
    });
    // Populate before emitting/responding so real-time (socket) delivery renders
    // identically to a REST fetch (getMessages already populates senderUserId).
    await message.populate('senderUserId', 'fullName email role');

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

const getConversationDetail = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const conversation = await Conversation.findById(conversationId).populate('participantUserIds', 'fullName email role').lean();
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    if (!assertConversationAccess(req.user, conversation)) {
      return res.status(403).json({ message: 'Access forbidden' });
    }
    return res.json({ success: true, data: conversation });
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

    if (!assertConversationAccess(req.user, conversation)) {
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

    const regex = new RegExp(escapeRegex(q), 'i');
    const scopeFilter = buildConversationScopeFilter(req.user);

    // Find conversations by subject, restricted to what this user may see
    const convFilter = { $and: [{ subject: { $regex: regex } }, scopeFilter] };

    const convsBySubject = await Conversation.find(convFilter).populate('participantUserIds', 'fullName email role').lean();

    // Find messages containing q, restricted to conversations within this user's scope
    const scopedConvs = await Conversation.find(scopeFilter).select('_id');
    const msgFilter = { content: { $regex: regex }, conversationId: { $in: scopedConvs.map((c) => c._id) } };
    const msgs = await Message.find(msgFilter).select('conversationId').lean();
    const convIdsFromMsgs = msgs.map((m) => String(m.conversationId));

    const convs = convsBySubject.slice();
    if (convIdsFromMsgs.length) {
      const fromMsgs = await Conversation.find({ _id: { $in: convIdsFromMsgs } })
        .populate('participantUserIds', 'fullName email role')
        .lean();
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
    const regex = new RegExp(escapeRegex(q), 'i');

    // if conversationId provided, restrict to that conversation
    if (conversationId) {
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
      if (!assertConversationAccess(req.user, conversation)) {
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

    // Global search: restrict to this user's conversation scope
    const scopeFilter = buildConversationScopeFilter(req.user);
    const scopedConvs = await Conversation.find(scopeFilter).select('_id');
    const scopedConvIds = scopedConvs.map((c) => c._id);
    const msgFilter = { content: { $regex: regex }, conversationId: { $in: scopedConvIds } };

    // find persisted messages
    const dbMsgs = await Message.find(msgFilter)
      .sort({ sentAt: -1 })
      .limit(limit * 5)
      .populate('senderUserId', 'fullName email role')
      .lean();

    // include guest in-memory messages for guest conversations within scope
    const guestResults = [];
    const scopedConvIdSet = new Set(scopedConvIds.map(String));
    const guestConvs = await Conversation.find({ isGuest: true }).select('_id subject');
    for (const c of guestConvs) {
      if (!scopedConvIdSet.has(String(c._id))) continue;
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

    // Admin, the owning family, or a staff participant may delete their own conversation.
    if (!assertConversationAccess(req.user, conversation)) {
      return res.status(403).json({ message: 'Access forbidden' });
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
  getStaffDirectory,
  getCareTeam,
  listConversations,
  getConversationDetail,
  getMessages,
  deleteConversation,
  searchConversations,
  searchMessages,
};

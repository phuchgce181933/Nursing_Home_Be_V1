const ServiceError = require('./serviceError');
const conversationRepo = require('../repositories/conversationRepository');
const messageRepo = require('../repositories/messageRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const userRepo = require('../repositories/userRepository');
const guestMessageStore = require('../utils/guestMessageStore');
const { validateEmail, validatePhone, escapeRegex } = require('../utils/validators');

const residentRepo = require('../repositories/residentRepository');

const SENDER_POPULATE = { path: 'senderUserId', select: 'fullName email role' };
const PARTICIPANT_POPULATE = { path: 'participantUserIds', select: 'fullName email role' };

const assertConversationAccess = (user, conversation) => {
  if (user.role === 'admin') return true;
  if (conversation.isGuest) return user.role !== 'family';
  if (user.role === 'family') return String(conversation.familyAccountId) === String(user._id);
  const participantIds = (conversation.participantUserIds || []).map((p) => String(p && p._id ? p._id : p));
  return participantIds.includes(String(user._id));
};

const buildConversationScopeFilter = (user) => {
  if (user.role === 'admin') return {};
  if (user.role === 'family') return { familyAccountId: user._id };
  return { $or: [{ participantUserIds: user._id }, { isGuest: true }] };
};

const getCareTeamForFamily = async (familyUserId) => {
  const residents = await residentRepo.findByFilterLean({ familyPortalAccountIds: familyUserId }, { select: '_id' });
  const residentIds = residents.map((r) => r._id);
  if (!residentIds.length) return [];

  const profiles = await staffProfileRepo.findByAssignedResidentId(null);
  const allProfiles = await staffProfileRepo.findByFilterLean(
    { assignedResidentIds: { $in: residentIds } },
    { populate: { path: 'userId', select: 'fullName email role isActive' } }
  );

  const seen = new Set();
  const careTeam = [];
  for (const p of allProfiles) {
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

const getCareTeam = async (user) => {
  if (user.role !== 'family') throw new ServiceError('Truy cập bị từ chối', 403);
  return getCareTeamForFamily(user._id);
};

const createConversation = async ({ body, user }) => {
  const { familyAccountId, participantUserIds = [], subject, targetUserId } = body;

  if (user.role === 'family') {
    const famId = user._id;
    const findQuery = { familyAccountId: famId, subject: subject || null };
    if (targetUserId) findQuery.participantUserIds = { $all: [famId, targetUserId] };

    let conversation = await conversationRepo.findOne(findQuery);
    if (!conversation) {
      let resolvedTargetUserId = null;
      if (targetUserId) {
        const careTeam = await getCareTeamForFamily(famId);
        if (!careTeam.some((u) => String(u._id) === String(targetUserId))) {
          throw new ServiceError('Nhân viên này không thuộc đội ngũ chăm sóc của bạn', 403);
        }
        resolvedTargetUserId = targetUserId;
      }
      conversation = await conversationRepo.create({
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
    return conversation;
  }

  if (targetUserId && !familyAccountId) {
    if (String(targetUserId) === String(user._id)) {
      throw new ServiceError('targetUserId phải là một người dùng khác', 400);
    }
    const targetUser = await userRepo.findById(targetUserId);
    if (!targetUser) throw new ServiceError('Không tìm thấy người dùng đích', 404);

    let conversation = await conversationRepo.findOne({
      familyAccountId: null,
      participantUserIds: { $all: [user._id, targetUserId], $size: 2 },
    });
    if (!conversation) {
      conversation = await conversationRepo.create({
        familyAccountId: null,
        participantUserIds: [user._id, targetUserId],
        subject,
      });
    }
    return conversation;
  }

  if (!familyAccountId) throw new ServiceError('familyAccountId hoặc targetUserId là bắt buộc', 400);

  let conversation = await conversationRepo.findOne({ familyAccountId, subject: subject || null });
  if (!conversation) {
    conversation = await conversationRepo.create({
      familyAccountId,
      participantUserIds: Array.from(new Set([String(user._id), ...(Array.isArray(participantUserIds) ? participantUserIds : []).map(String)])),
      subject,
    });
  }
  return conversation;
};

const getStaffDirectory = async (userId) => {
  return userRepo.findByFilterLean(
    { role: { $ne: 'family' }, isActive: true, _id: { $ne: userId } },
    { select: 'fullName email role', sort: { fullName: 1 } }
  );
};

const createGuestConversation = async ({ body }) => {
  const { guestName, guestEmail, guestPhone, subject, content, attachments = [] } = body;
  if (!guestName) throw new ServiceError('guestName là bắt buộc', 400);
  if (!guestEmail && !guestPhone) throw new ServiceError('guestEmail hoặc guestPhone là bắt buộc', 400);
  if (guestEmail) {
    const emailErr = validateEmail(guestEmail);
    if (emailErr) throw new ServiceError(emailErr, 400);
  }
  if (guestPhone) {
    const phoneErr = validatePhone(guestPhone);
    if (phoneErr) throw new ServiceError(phoneErr, 400);
  }

  const conversation = await conversationRepo.create({
    isGuest: true,
    guestName,
    guestEmail,
    guestPhone,
    subject: subject || null,
  });

  let message = null;
  if (content && typeof content === 'string' && content.trim()) {
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
    await conversationRepo.saveDoc(conversation);
  }

  return { conversation, message };
};

const createGuestMessage = async ({ conversationId, body }) => {
  const { content, attachments = [], guestName, guestEmail, guestPhone } = body;
  const hasContent = typeof content === 'string' && content.trim().length > 0;
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  if (!hasContent && !hasAttachments) throw new ServiceError('Nội dung hoặc tệp đính kèm là bắt buộc', 400);

  const conversation = await conversationRepo.findById(conversationId);
  if (!conversation) throw new ServiceError('Không tìm thấy cuộc trò chuyện', 404);
  if (!conversation.isGuest) throw new ServiceError('Không phải cuộc trò chuyện của khách', 403);

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
  await conversationRepo.saveDoc(conversation);

  return { conversation, message };
};

const getGuestMessages = async ({ conversationId, page = 1, limit = 50 }) => {
  const conversation = await conversationRepo.findById(conversationId);
  if (!conversation) throw new ServiceError('Không tìm thấy cuộc trò chuyện', 404);
  if (!conversation.isGuest) throw new ServiceError('Không phải cuộc trò chuyện của khách', 403);

  const dbMsgs = await messageRepo.findByConversation(conversationId, {
    populate: [SENDER_POPULATE],
  });
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
  all.sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt));
  const start = (page - 1) * limit;
  const items = all.slice(start, start + limit);

  return { items, page, limit, total: all.length };
};

const createMessage = async ({ conversationId, body, user }) => {
  const { content, attachments = [], participantUserIds = [] } = body;
  const hasContent = typeof content === 'string' && content.trim().length > 0;
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  if (!hasContent && !hasAttachments) throw new ServiceError('Nội dung hoặc tệp đính kèm là bắt buộc', 400);

  const conversation = await conversationRepo.findById(conversationId);
  if (!conversation) throw new ServiceError('Không tìm thấy cuộc trò chuyện', 404);
  if (!assertConversationAccess(user, conversation)) throw new ServiceError('Truy cập bị từ chối', 403);

  const message = await messageRepo.create({
    conversationId: conversation._id,
    senderUserId: user._id,
    content: hasContent ? content.trim() : '',
    attachments: Array.isArray(attachments) ? attachments : [],
  });
  await message.populate('senderUserId', 'fullName email role');

  const participants = new Set([...(conversation.participantUserIds || []).map(String), String(user._id), ...(participantUserIds || []).map(String)]);
  conversation.participantUserIds = Array.from(participants);
  conversation.lastMessageAt = message.sentAt || message.createdAt || new Date();
  await conversationRepo.saveDoc(conversation);

  return { conversation, message };
};

const getUnreadCountsByConversation = async (conversationIds, userId) => {
  if (!conversationIds.length) return new Map();
  const rows = await messageRepo.aggregate([
    {
      $match: {
        conversationId: { $in: conversationIds },
        senderUserId: { $ne: userId },
        readByUserIds: { $ne: userId },
      },
    },
    { $group: { _id: '$conversationId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
};

const listConversations = async ({ user }) => {
  let filter = {};
  if (user.role === 'family') {
    filter.familyAccountId = user._id;
  } else if (user.role === 'admin') {
    filter = {};
  } else {
    filter.$or = [{ participantUserIds: user._id }];
  }

  const conversations = await conversationRepo.findAll(filter, {
    sort: { lastMessageAt: -1 },
    populate: [PARTICIPANT_POPULATE],
  });

  const unreadCounts = await getUnreadCountsByConversation(conversations.map((c) => c._id), user._id);
  return conversations.map((c) => ({ ...c, unreadCount: unreadCounts.get(String(c._id)) || 0 }));
};

const markMessagesRead = async ({ conversationId, user }) => {
  const conversation = await conversationRepo.findById(conversationId);
  if (!conversation) throw new ServiceError('Không tìm thấy cuộc trò chuyện', 404);
  if (!assertConversationAccess(user, conversation)) throw new ServiceError('Truy cập bị từ chối', 403);

  await messageRepo.updateMany(
    { conversationId: conversation._id, senderUserId: { $ne: user._id } },
    { $addToSet: { readByUserIds: user._id } }
  );
};

const getConversationDetail = async ({ conversationId, user }) => {
  const conversation = await conversationRepo.findByIdPopulated(conversationId);
  if (!conversation) throw new ServiceError('Không tìm thấy cuộc trò chuyện', 404);
  if (!assertConversationAccess(user, conversation)) throw new ServiceError('Truy cập bị từ chối', 403);
  return conversation;
};

const getMessages = async ({ conversationId, user, page = 1, limit = 50 }) => {
  const conversation = await conversationRepo.findById(conversationId);
  if (!conversation) throw new ServiceError('Không tìm thấy cuộc trò chuyện', 404);
  if (!assertConversationAccess(user, conversation)) throw new ServiceError('Truy cập bị từ chối', 403);

  if (conversation.isGuest) {
    const dbMsgs = await messageRepo.findByConversation(conversationId, {
      sort: { sentAt: -1 },
      populate: [SENDER_POPULATE],
    });
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
    const combined = [...dbMsgs.map(normalize), ...guestMsgs.map(normalize)];
    combined.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    const total = combined.length;
    const start = (page - 1) * limit;
    const items = combined.slice(start, start + limit);
    return { items, page, limit, total };
  }

  const messages = await messageRepo.findByConversation(conversationId, {
    sort: { sentAt: -1 },
    skip: (page - 1) * limit,
    limit,
    populate: [SENDER_POPULATE],
  });
  return { items: messages, page, limit };
};

const searchConversations = async ({ user, q }) => {
  if (!q) throw new ServiceError('Từ khóa tìm kiếm (q) là bắt buộc', 400);
  const regex = new RegExp(escapeRegex(q), 'i');
  const scopeFilter = buildConversationScopeFilter(user);

  const convFilter = { $and: [{ subject: { $regex: regex } }, scopeFilter] };
  const convsBySubject = await conversationRepo.findAll(convFilter, { populate: [PARTICIPANT_POPULATE] });

  const scopedConvs = await conversationRepo.findSelect(scopeFilter, '_id');
  const msgs = await messageRepo.findByFilterLean({ content: { $regex: regex }, conversationId: { $in: scopedConvs.map((c) => c._id) } }, 'conversationId');
  const convIdsFromMsgs = msgs.map((m) => String(m.conversationId));

  const convs = convsBySubject.slice();
  if (convIdsFromMsgs.length) {
    const fromMsgs = await conversationRepo.findAll({ _id: { $in: convIdsFromMsgs } }, { populate: [PARTICIPANT_POPULATE] });
    const seen = new Set(convs.map((c) => String(c._id)));
    for (const c of fromMsgs) if (!seen.has(String(c._id))) convs.push(c);
  }

  return convs;
};

const searchMessages = async ({ user, q, conversationId, page = 1, limit = 50 }) => {
  if (!q) throw new ServiceError('Từ khóa tìm kiếm (q) là bắt buộc', 400);
  const regex = new RegExp(escapeRegex(q), 'i');

  if (conversationId) {
    const conversation = await conversationRepo.findById(conversationId);
    if (!conversation) throw new ServiceError('Không tìm thấy cuộc trò chuyện', 404);
    if (!assertConversationAccess(user, conversation)) throw new ServiceError('Truy cập bị từ chối', 403);

    const dbMsgs = await messageRepo.findByConversation(conversationId, {
      sort: { sentAt: -1 },
      populate: [SENDER_POPULATE],
    });
    const filteredDb = dbMsgs.filter((m) => regex.test(m.content || ''));

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

    const combined = [...filteredDb.map((m) => ({ ...m, isGuest: false })), ...guestMsgs];
    combined.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    const total = combined.length;
    const start = (page - 1) * limit;
    const items = combined.slice(start, start + limit);
    return { items, page, limit, total };
  }

  const scopeFilter = buildConversationScopeFilter(user);
  const scopedConvs = await conversationRepo.findSelect(scopeFilter, '_id');
  const scopedConvIds = scopedConvs.map((c) => c._id);

  const dbMsgs = await messageRepo.findByFilter(
    { content: { $regex: regex }, conversationId: { $in: scopedConvIds } },
    { sort: { sentAt: -1 }, limit: limit * 5, populate: [SENDER_POPULATE] }
  );
  const dbMsgsLean = await Promise.resolve(dbMsgs.lean ? dbMsgs.lean() : dbMsgs);

  const guestResults = [];
  const scopedConvIdSet = new Set(scopedConvIds.map(String));
  const guestConvs = await conversationRepo.findByFilterLean({ isGuest: true }, { select: '_id subject' });
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

  const combined = [...(Array.isArray(dbMsgsLean) ? dbMsgsLean : []).map((m) => ({ ...m, isGuest: false })), ...guestResults];
  combined.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  const total = combined.length;
  const start = (page - 1) * limit;
  const items = combined.slice(start, start + limit);
  return { items, page, limit, total };
};

const deleteConversation = async ({ conversationId, user }) => {
  const conversation = await conversationRepo.findById(conversationId);
  if (!conversation) throw new ServiceError('Không tìm thấy cuộc trò chuyện', 404);
  if (!assertConversationAccess(user, conversation)) throw new ServiceError('Truy cập bị từ chối', 403);

  await messageRepo.deleteByConversation(conversation._id);
  try { guestMessageStore.clearConversation(conversationId); } catch (e) {}
  await conversationRepo.deleteById(conversation._id);
  return conversation;
};

module.exports = {
  getCareTeam,
  createConversation,
  getStaffDirectory,
  createGuestConversation,
  createGuestMessage,
  getGuestMessages,
  createMessage,
  listConversations,
  markMessagesRead,
  getConversationDetail,
  getMessages,
  searchConversations,
  searchMessages,
  deleteConversation,
};

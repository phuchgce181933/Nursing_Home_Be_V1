const supportRequestRepo = require('../repositories/supportRequestRepository');
const mongoose = require('mongoose');

const FAMILY_POPULATE = { path: 'familyAccountId', select: 'fullName email phone' };

const submitSupportRequest = async (user, payload /*, req */) => {
  const { fullName, age, phone, address, notes } = payload || {};
  if (!fullName || typeof fullName !== 'string') throw { statusCode: 400, message: 'fullName là bắt buộc' };
  if (age === undefined || Number.isNaN(Number(age))) throw { statusCode: 400, message: 'age là bắt buộc' };
  if (!phone || !phone.trim()) throw { statusCode: 400, message: 'phone là bắt buộc' };
  if (!address || !address.trim()) throw { statusCode: 400, message: 'address là bắt buộc' };

  const subject = `Yêu cầu hỗ trợ từ ${fullName}`;
  const doc = await supportRequestRepo.create({
    familyAccountId: new mongoose.Types.ObjectId(user._id || user.id),
    subject,
    fullName,
    age: Number(age),
    phone,
    address,
    notes: notes || null,
    status: 'open',
  });

  return doc;
};

const isStaffRole = (role) => role === 'admin' || role === 'manager';

const listSupportRequests = async (user, query) => {
  const page = Number(query.page) || 1;
  const limit = Math.min(Number(query.limit) || 20, 100);
  const filter = {};
  // family users only see their own requests; staff can see all or filter by familyAccountId
  if (!isStaffRole(user.role)) {
    filter.familyAccountId = new mongoose.Types.ObjectId(user._id || user.id);
  } else if (query.familyAccountId) {
    filter.familyAccountId = new mongoose.Types.ObjectId(query.familyAccountId);
  }

  if (query.status) filter.status = query.status;

  const total = await supportRequestRepo.count(filter);
  const populate = isStaffRole(user.role) ? FAMILY_POPULATE : undefined;
  const items = await supportRequestRepo.find(filter, { page, limit, populate });

  return { page, limit, total, items };
};

const assertRequestAccess = (doc, user) => {
  const isOwner = String(doc.familyAccountId) === String(user._id || user.id);
  if (!isOwner && !isStaffRole(user.role)) {
    throw { statusCode: 403, message: 'Truy cập bị từ chối' };
  }
};

const getSupportRequest = async (user, requestId) => {
  const doc = await supportRequestRepo.findDocById(requestId);
  if (!doc) throw { statusCode: 404, message: 'Không tìm thấy yêu cầu hỗ trợ' };
  assertRequestAccess(doc, user);

  await doc.populate(FAMILY_POPULATE);
  return doc;
};

const closeSupportRequest = async (user, requestId, body /*, req */) => {
  const action = body && body.action ? body.action : 'close';
  if (!['close', 'cancel'].includes(action)) throw { statusCode: 400, message: 'Hành động không hợp lệ' };

  const doc = await supportRequestRepo.findDocById(requestId);
  if (!doc) throw { statusCode: 404, message: 'Không tìm thấy yêu cầu hỗ trợ' };
  assertRequestAccess(doc, user);

  if (doc.status === 'closed' || doc.status === 'resolved') {
    throw { statusCode: 400, message: 'Yêu cầu đã được đóng' };
  }

  doc.status = action === 'cancel' ? 'closed' : 'resolved';
  doc.closedAt = new Date();
  await doc.save();

  await doc.populate(FAMILY_POPULATE);
  return doc;
};

const addMessage = async (user, requestId, body) => {
  const text = body?.text?.trim();
  if (!text) throw { statusCode: 400, message: 'text là bắt buộc' };

  const doc = await supportRequestRepo.findDocById(requestId);
  if (!doc) throw { statusCode: 404, message: 'Không tìm thấy yêu cầu hỗ trợ' };
  assertRequestAccess(doc, user);

  doc.messages.push({
    senderId: user._id || user.id,
    senderRole: user.role,
    text,
    sentAt: new Date(),
  });

  if (isStaffRole(user.role) && doc.status === 'open') {
    doc.status = 'in_progress';
  }

  await doc.save();
  await doc.populate(FAMILY_POPULATE);
  return doc;
};

module.exports = {
  submitSupportRequest,
  listSupportRequests,
  getSupportRequest,
  closeSupportRequest,
  addMessage,
};

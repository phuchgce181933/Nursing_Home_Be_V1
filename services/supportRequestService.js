const { SupportRequest } = require('../models');
const mongoose = require('mongoose');

const submitSupportRequest = async (user, payload /*, req */) => {
  const { fullName, age, phone, address, notes } = payload || {};
  if (!fullName || typeof fullName !== 'string') throw { statusCode: 400, message: 'fullName is required' };
  if (age === undefined || Number.isNaN(Number(age))) throw { statusCode: 400, message: 'age is required' };
  if (!phone || !phone.trim()) throw { statusCode: 400, message: 'phone is required' };
  if (!address || !address.trim()) throw { statusCode: 400, message: 'address is required' };

  const subject = `Support request from ${fullName}`;
  const doc = await SupportRequest.create({
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

const listSupportRequests = async (user, query) => {
  const page = Number(query.page) || 1;
  const limit = Math.min(Number(query.limit) || 20, 100);
  const filter = {};
  // family users only see their own requests; admin can see all or filter by familyAccountId
  if (user.role === 'family') {
    filter.familyAccountId = new mongoose.Types.ObjectId(user._id || user.id);
  } else if (user.role === 'admin' && query.familyAccountId) {
    filter.familyAccountId = new mongoose.Types.ObjectId(query.familyAccountId);
  }

  if (query.status) filter.status = query.status;

  const total = await SupportRequest.countDocuments(filter);
  const items = await SupportRequest.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  return { page, limit, total, items };
};

const getSupportRequest = async (user, requestId) => {
  let doc;
  if (user.role === 'admin') {
    doc = await SupportRequest.findById(requestId).lean();
  } else {
    doc = await SupportRequest.findOne({ _id: requestId, familyAccountId: new mongoose.Types.ObjectId(user._id || user.id) }).lean();
  }

  if (!doc) throw { statusCode: 404, message: 'Support request not found' };
  return doc;
};

const closeSupportRequest = async (user, requestId, body /*, req */) => {
  const action = body && body.action ? body.action : 'close';
  if (!['close', 'cancel'].includes(action)) throw { statusCode: 400, message: 'Invalid action' };

  const doc = await SupportRequest.findById(requestId);
  if (!doc) throw { statusCode: 404, message: 'Support request not found' };

  // ensure family can only close their own requests
  if (user.role === 'family' && String(doc.familyAccountId) !== String(user._id || user.id)) {
    throw { statusCode: 403, message: 'Forbidden' };
  }

  if (doc.status === 'closed' || doc.status === 'resolved') {
    throw { statusCode: 400, message: 'Request already closed' };
  }

  doc.status = action === 'cancel' ? 'closed' : 'resolved';
  doc.closedAt = new Date();
  await doc.save();

  return doc.toObject();
};

module.exports = {
  submitSupportRequest,
  listSupportRequests,
  getSupportRequest,
  closeSupportRequest,
};

const consultationRequestRepo = require('../repositories/consultationRequestRepository');
const notificationRepo = require('../repositories/notificationRepository');
const User = require('../models/user');
const ServiceError = require('./serviceError');
const { CONSULTATION_REQUEST_STATUSES } = require('../models/enums');
const mongoose = require('mongoose');

const REQUEST_STATUSES = Array.isArray(CONSULTATION_REQUEST_STATUSES)
  ? CONSULTATION_REQUEST_STATUSES
  : ['open', 'in_progress', 'resolved', 'closed'];

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const formatRequest = (doc) => ({
  _id: doc._id,
  fullName: doc.fullName,
  age: doc.age,
  phone: doc.phone,
  email: doc.email,
  address: doc.address,
  serviceInterest: doc.serviceInterest,
  subject: doc.subject,
  message: doc.message,
  status: doc.status,
  adminNotes: doc.adminNotes,
  closedAt: doc.closedAt,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

const isValidStatusTransition = (currentStatus, nextStatus) => {
  const statusOrder = ['open', 'in_progress', 'resolved', 'closed'];
  const currentIndex = statusOrder.indexOf(currentStatus);
  const nextIndex = statusOrder.indexOf(nextStatus);
  return currentIndex !== -1 && nextIndex !== -1 && nextIndex >= currentIndex;
};

const notifyAdminsOfNewConsultationRequest = async (request) => {
  const adminUsers = await User.find({ role: 'admin', isActive: true, isBanned: false }).select('_id').lean();
  if (!adminUsers.length) return;

  const notifications = adminUsers.map((recipient) => ({
    recipientUserId: recipient._id,
    category: 'system',
    title: 'Yêu cầu tư vấn mới',
    content: `Có yêu cầu tư vấn mới từ ${request.fullName || 'khách hàng'}${request.serviceInterest ? `. Nội dung: ${request.serviceInterest}` : ''}.`,
    targetEntityType: 'ConsultationRequest',
    targetEntityId: request._id,
    deliveryChannels: ['in_app'],
    sentAt: new Date(),
  }));

  await notificationRepo.insertMany(notifications);
};

const submitConsultationRequest = async (body, req) => {
  if (!body || typeof body !== 'object') {
    throw new ServiceError('Request body is required', 400);
  }

  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  const serviceInterest = typeof body.serviceInterest === 'string' ? body.serviceInterest.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const age = body.age !== undefined ? Number(body.age) : undefined;

  if (!fullName) {
    throw new ServiceError('fullName is required', 400);
  }
  if (fullName.length < 2 || fullName.length > 100) {
    throw new ServiceError('fullName must be between 2 and 100 characters', 400);
  }

  if (age !== undefined && Number.isNaN(age)) {
    throw new ServiceError('age must be a number', 400);
  }
  if (age !== undefined && age < 0) {
    throw new ServiceError('age cannot be negative', 400);
  }

  if (!phone) {
    throw new ServiceError('phone is required', 400);
  }
  const normalizedPhone = phone.replace(/\s+/g, '');
  if (!/^\+?[0-9]{9,15}$/.test(normalizedPhone)) {
    throw new ServiceError('phone must be a valid phone number', 400);
  }

  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ServiceError('email must be valid', 400);
  }

  if (!serviceInterest && !subject && !message) {
    throw new ServiceError('Please provide a service interest, subject, or message', 400);
  }

  const request = await consultationRequestRepo.create({
    fullName,
    age: age === undefined ? undefined : age,
    phone: normalizedPhone,
    email: email || undefined,
    address: address || undefined,
    serviceInterest: serviceInterest || undefined,
    subject: subject || undefined,
    message: message || undefined,
    status: 'open',
  });

  await notifyAdminsOfNewConsultationRequest(request);

  return { message: 'Consultation request submitted successfully', request: formatRequest(request) };
};

const listConsultationRequests = async (query) => {
  const page = Math.max(1, parseInt(query.page || 1, 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const filter = {};

  if (query.status) {
    if (!REQUEST_STATUSES.includes(query.status)) {
      throw new ServiceError(`status must be one of: ${REQUEST_STATUSES.join(', ')}`, 400);
    }
    filter.status = query.status;
  }

  if (query.search) {
    const escaped = escapeRegex(query.search.trim());
    filter.$or = [
      { fullName: { $regex: escaped, $options: 'i' } },
      { phone: { $regex: escaped, $options: 'i' } },
      { email: { $regex: escaped, $options: 'i' } },
      { serviceInterest: { $regex: escaped, $options: 'i' } },
      { subject: { $regex: escaped, $options: 'i' } },
      { message: { $regex: escaped, $options: 'i' } },
    ];
  }

  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) {
      const fromDate = new Date(query.from);
      if (Number.isNaN(fromDate.getTime())) throw new ServiceError('from date is invalid', 400);
      filter.createdAt.$gte = fromDate;
    }
    if (query.to) {
      const toDate = new Date(query.to);
      if (Number.isNaN(toDate.getTime())) throw new ServiceError('to date is invalid', 400);
      const endDate = new Date(query.to);
      endDate.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = endDate;
    }
  }

  const countsFilter = { ...filter };
  delete countsFilter.status;

  const [data, total, statusCounts] = await Promise.all([
    consultationRequestRepo.find(filter, { page, limit, sort: { createdAt: -1 } }),
    consultationRequestRepo.count(filter),
    consultationRequestRepo.countByStatus(countsFilter),
  ]);

  return {
    data: data.map(formatRequest),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
    statusCounts,
  };
};

const getConsultationRequest = async (requestId) => {
  if (!mongoose.isValidObjectId(requestId)) {
    throw new ServiceError('Invalid request ID', 400);
  }

  const request = await consultationRequestRepo.findById(requestId);
  if (!request) {
    throw new ServiceError('Consultation request not found', 404);
  }

  return formatRequest(request);
};

const updateConsultationRequest = async (requestId, body) => {
  if (!mongoose.isValidObjectId(requestId)) {
    throw new ServiceError('Invalid request ID', 400);
  }

  const request = await consultationRequestRepo.findById(requestId);
  if (!request) {
    throw new ServiceError('Consultation request not found', 404);
  }

  const update = {};
  if (body.status !== undefined) {
    if (!REQUEST_STATUSES.includes(body.status)) {
      throw new ServiceError(`status must be one of: ${REQUEST_STATUSES.join(', ')}`, 400);
    }
    if (!isValidStatusTransition(request.status, body.status)) {
      throw new ServiceError(`Invalid status transition from ${request.status} to ${body.status}`, 400);
    }
    update.status = body.status;
    if (['resolved', 'closed'].includes(body.status)) {
      update.closedAt = new Date();
    } else {
      update.closedAt = undefined;
    }
  }

  if (body.adminNotes !== undefined) {
    update.adminNotes = typeof body.adminNotes === 'string' ? body.adminNotes.trim() : request.adminNotes;
  }

  if (Object.keys(update).length === 0) {
    throw new ServiceError('Nothing to update', 400);
  }

  const updated = await consultationRequestRepo.updateById(requestId, update);
  return formatRequest(updated);
};

module.exports = {
  submitConsultationRequest,
  listConsultationRequests,
  getConsultationRequest,
  updateConsultationRequest,
};

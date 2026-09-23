const consultationRequestRepo = require('../repositories/consultationRequestRepository');
const notificationRepo = require('../repositories/notificationRepository');
const userRepo = require('../repositories/userRepository');
const ServiceError = require('./serviceError');
const { CONSULTATION_REQUEST_STATUSES } = require('../models/enums');
const { createAuditLog } = require('../utils/auditLog');
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

const STATUS_LABELS = {
  open: 'Mới',
  in_progress: 'Đang xử lý',
  resolved: 'Đã xử lý',
  closed: 'Đã đóng',
};

const getStatusLabel = (status) => STATUS_LABELS[status] || status;

const formatDateTimeVN = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
};

const notifyAdminsOfNewConsultationRequest = async (request) => {
  const adminUsers = await userRepo.findByFilterLean({ role: 'admin', isActive: true, isBanned: false }, { select: '_id' });
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
    throw new ServiceError('Nội dung yêu cầu là bắt buộc', 400);
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
    throw new ServiceError('fullName là bắt buộc', 400);
  }
  if (fullName.length < 2 || fullName.length > 100) {
    throw new ServiceError('fullName phải có độ dài từ 2 đến 100 ký tự', 400);
  }

  if (age !== undefined && Number.isNaN(age)) {
    throw new ServiceError('age phải là một số', 400);
  }
  if (age !== undefined && age < 0) {
    throw new ServiceError('age không được là số âm', 400);
  }

  if (!phone) {
    throw new ServiceError('phone là bắt buộc', 400);
  }
  const normalizedPhone = phone.replace(/\s+/g, '');
  if (!/^\+?[0-9]{9,15}$/.test(normalizedPhone)) {
    throw new ServiceError('phone phải là số điện thoại hợp lệ', 400);
  }

  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ServiceError('email phải hợp lệ', 400);
  }

  if (!serviceInterest && !subject && !message) {
    throw new ServiceError('Vui lòng cung cấp lĩnh vực quan tâm, chủ đề hoặc nội dung tin nhắn', 400);
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

  await createAuditLog({
    actorUserId: null,
    actorRole: 'guest',
    action: 'SUBMIT_CONSULTATION_REQUEST',
    displayAction: 'Gửi yêu cầu tư vấn',
    module: 'consultationRequest',
    businessModule: 'consultationRequest',
    targetEntityType: 'ConsultationRequest',
    targetEntityId: request._id,
    targetName: request.fullName,
    description: `Khách ${request.fullName} đã gửi yêu cầu tư vấn${request.serviceInterest ? ` về: ${request.serviceInterest}` : ''}`,
    beforeData: null,
    afterData: {
      fullName: request.fullName,
      age: request.age,
      phone: request.phone,
      email: request.email,
      address: request.address,
      serviceInterest: request.serviceInterest,
      subject: request.subject,
      message: request.message,
      status: request.status,
    },
    metadata: {
      channel: 'public-contact-form',
    },
    req,
  });

  return { message: 'Đã gửi yêu cầu tư vấn thành công', request: formatRequest(request) };
};

const listConsultationRequests = async (query) => {
  const page = Math.max(1, parseInt(query.page || 1, 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const filter = {};

  if (query.status) {
    if (!REQUEST_STATUSES.includes(query.status)) {
      throw new ServiceError(`status phải thuộc một trong: ${REQUEST_STATUSES.join(', ')}`, 400);
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
      if (Number.isNaN(fromDate.getTime())) throw new ServiceError('Ngày from không hợp lệ', 400);
      filter.createdAt.$gte = fromDate;
    }
    if (query.to) {
      const toDate = new Date(query.to);
      if (Number.isNaN(toDate.getTime())) throw new ServiceError('Ngày to không hợp lệ', 400);
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
    throw new ServiceError('ID yêu cầu không hợp lệ', 400);
  }

  const request = await consultationRequestRepo.findById(requestId);
  if (!request) {
    throw new ServiceError('Không tìm thấy yêu cầu tư vấn', 404);
  }

  return formatRequest(request);
};

const updateConsultationRequest = async (requestId, body, req) => {
  if (!mongoose.isValidObjectId(requestId)) {
    throw new ServiceError('ID yêu cầu không hợp lệ', 400);
  }

  const request = await consultationRequestRepo.findById(requestId);
  if (!request) {
    throw new ServiceError('Không tìm thấy yêu cầu tư vấn', 404);
  }

  const update = {};
  const beforeData = {};
  const afterData = {};

  if (body.status !== undefined) {
    if (!REQUEST_STATUSES.includes(body.status)) {
      throw new ServiceError(`status phải thuộc một trong: ${REQUEST_STATUSES.join(', ')}`, 400);
    }
    if (!isValidStatusTransition(request.status, body.status)) {
      throw new ServiceError(`Không thể chuyển trạng thái từ ${request.status} sang ${body.status}`, 400);
    }
    update.status = body.status;
    beforeData.statusLabel = getStatusLabel(request.status);
    afterData.statusLabel = getStatusLabel(body.status);
    if (['resolved', 'closed'].includes(body.status)) {
      update.closedAt = new Date();
      afterData.closedAtLabel = `Đã đóng lúc ${formatDateTimeVN(update.closedAt)}`;
    } else {
      update.closedAt = undefined;
    }
  }

  if (body.adminNotes !== undefined) {
    const newNotes = typeof body.adminNotes === 'string' ? body.adminNotes.trim() : request.adminNotes;
    update.adminNotes = newNotes;
    beforeData.adminNotes = request.adminNotes;
    afterData.adminNotes = newNotes;
  }

  if (Object.keys(update).length === 0) {
    throw new ServiceError('Không có gì để cập nhật', 400);
  }

  const updated = await consultationRequestRepo.updateById(requestId, update);

  await createAuditLog({
    actorUserId: req?.user?._id || null,
    actorRole: req?.user?.role || 'admin',
    action: 'UPDATE_CONSULTATION_REQUEST',
    displayAction: 'Cập nhật yêu cầu tư vấn',
    module: 'consultationRequest',
    businessModule: 'consultationRequest',
    targetEntityType: 'ConsultationRequest',
    targetEntityId: updated._id,
    targetName: updated.fullName,
    description: body.status !== undefined
      ? `${req?.user?.fullName || 'Quản trị viên'} đã chuyển trạng thái yêu cầu của ${updated.fullName} từ "${getStatusLabel(request.status)}" sang "${getStatusLabel(body.status)}"`
      : `${req?.user?.fullName || 'Quản trị viên'} đã cập nhật yêu cầu tư vấn của ${updated.fullName}`,
    beforeData,
    afterData,
    metadata: {
      updatedFields: Object.keys(update),
    },
    req,
  });

  return formatRequest(updated);
};

module.exports = {
  submitConsultationRequest,
  listConsultationRequests,
  getConsultationRequest,
  updateConsultationRequest,
};

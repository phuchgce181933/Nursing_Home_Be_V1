const ServiceError = require('./serviceError');
const careAppointmentRepo = require('../repositories/careAppointmentRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const notificationRepo = require('../repositories/notificationRepository');
const { createAuditLog } = require('../utils/auditLog');

const VALID_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const validateAppointmentWindow = (start, end) => {
  if (isNaN(start) || isNaN(end)) throw new ServiceError('Invalid date format', 400);
  if (start >= end) throw new ServiceError('scheduledEndAt must be after scheduledStartAt', 400);
};

const createAppointment = async (user, body, req) => {
  const { residentId, doctorStaffId, nurseStaffId, scheduledStartAt, scheduledEndAt, appointmentType, notes } = body;
  if (!residentId || !scheduledStartAt || !scheduledEndAt) {
    throw new ServiceError('residentId, scheduledStartAt and scheduledEndAt are required', 400);
  }

  const start = new Date(scheduledStartAt);
  const end = new Date(scheduledEndAt);
  validateAppointmentWindow(start, end);

  const conflict = await careAppointmentRepo.findOneConflict(residentId, start, end);
  if (conflict) {
    throw new ServiceError('Schedule conflict: resident already has an appointment in this time slot', 409);
  }

  const appointment = await careAppointmentRepo.createAppointment({
    residentId,
    doctorStaffId: doctorStaffId || undefined,
    nurseStaffId: nurseStaffId || undefined,
    scheduledStartAt: start,
    scheduledEndAt: end,
    appointmentType,
    notes,
  });

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'CREATE',
    module: 'CareAppointment',
    targetEntityType: 'CareAppointment',
    targetEntityId: appointment._id,
    afterData: appointment.toObject(),
    req,
  });

  return careAppointmentRepo.findByIdWithPopulate(appointment._id);
};

const listAppointments = async (query) => {
  const filter = {};
  if (query.residentId) filter.residentId = query.residentId;
  if (query.status) filter.status = query.status;
  if (query.appointmentType) filter.appointmentType = query.appointmentType;
  if (query.doctorStaffId) filter.doctorStaffId = query.doctorStaffId;
  if (query.nurseStaffId) filter.nurseStaffId = query.nurseStaffId;
  if (query.from || query.to) {
    filter.scheduledStartAt = {};
    if (query.from) filter.scheduledStartAt.$gte = new Date(query.from);
    if (query.to) filter.scheduledStartAt.$lte = new Date(query.to);
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    careAppointmentRepo.findAppointmentsWithPopulate(filter, { sort: { scheduledStartAt: -1 }, skip, limit: limitNum }),
    careAppointmentRepo.countDocuments(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

const getDailySchedule = async (query) => {
  const refDate = query.date ? new Date(query.date) : new Date();
  if (isNaN(refDate)) throw new ServiceError('Invalid date', 400);

  const start = new Date(refDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(refDate);
  end.setHours(23, 59, 59, 999);

  const filter = { scheduledStartAt: { $gte: start, $lte: end } };
  if (query.residentId) filter.residentId = query.residentId;

  const appointments = await careAppointmentRepo.findAppointmentsWithPopulate(filter, { sort: { scheduledStartAt: 1 } });
  return { date: start, appointments };
};

const getWeeklySchedule = async (query) => {
  const refDate = query.date ? new Date(query.date) : new Date();
  if (isNaN(refDate)) throw new ServiceError('Invalid date', 400);

  const dow = refDate.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const weekStart = new Date(refDate);
  weekStart.setDate(refDate.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const filter = { scheduledStartAt: { $gte: weekStart, $lte: weekEnd } };
  if (query.residentId) filter.residentId = query.residentId;

  const appointments = await careAppointmentRepo.findAppointmentsWithPopulate(filter, { sort: { scheduledStartAt: 1 } });
  return { weekStart, weekEnd, appointments };
};

const getAppointment = async (id) => {
  const appointment = await careAppointmentRepo.findByIdWithPopulate(id);
  if (!appointment) throw new ServiceError('Appointment not found', 404);
  return appointment;
};

const updateAppointment = async (user, id, body, req) => {
  const appointment = await careAppointmentRepo.findById(id);
  if (!appointment) throw new ServiceError('Appointment not found', 404);

  const start = body.scheduledStartAt ? new Date(body.scheduledStartAt) : appointment.scheduledStartAt;
  const end = body.scheduledEndAt ? new Date(body.scheduledEndAt) : appointment.scheduledEndAt;
  validateAppointmentWindow(start, end);

  const conflict = await careAppointmentRepo.findOneConflict(appointment.residentId, start, end, appointment._id);
  if (conflict) throw new ServiceError('Schedule conflict detected', 409);

  const before = appointment.toObject();
  appointment.scheduledStartAt = start;
  appointment.scheduledEndAt = end;
  if (body.appointmentType !== undefined) appointment.appointmentType = body.appointmentType;
  if (body.notes !== undefined) appointment.notes = body.notes;
  await careAppointmentRepo.saveAppointment(appointment);

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'UPDATE',
    module: 'CareAppointment',
    targetEntityType: 'CareAppointment',
    targetEntityId: appointment._id,
    beforeData: before,
    afterData: appointment.toObject(),
    req,
  });

  return careAppointmentRepo.findByIdWithPopulate(appointment._id);
};

const deleteAppointment = async (user, id, req) => {
  const appointment = await careAppointmentRepo.findById(id);
  if (!appointment) throw new ServiceError('Appointment not found', 404);

  const before = appointment.toObject();
  await careAppointmentRepo.deleteAppointment(appointment);

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'DELETE',
    module: 'CareAppointment',
    targetEntityType: 'CareAppointment',
    targetEntityId: before._id,
    beforeData: before,
    req,
  });

  return { message: 'Appointment deleted successfully' };
};

const updateStatus = async (user, id, body, req) => {
  const { status } = body;
  if (!status || !VALID_STATUSES.includes(status)) {
    throw new ServiceError(`status must be one of: ${VALID_STATUSES.join(', ')}`, 400);
  }

  const appointment = await careAppointmentRepo.findById(id);
  if (!appointment) throw new ServiceError('Appointment not found', 404);

  const prevStatus = appointment.status;
  appointment.status = status;
  await careAppointmentRepo.saveAppointment(appointment);

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'UPDATE_STATUS',
    module: 'CareAppointment',
    targetEntityType: 'CareAppointment',
    targetEntityId: appointment._id,
    beforeData: { status: prevStatus },
    afterData: { status },
    req,
  });

  return appointment;
};

const assignDoctor = async (user, id, body, req) => {
  const { doctorStaffId } = body;
  if (doctorStaffId) {
    const staff = await staffProfileRepo.findById(doctorStaffId);
    if (!staff) throw new ServiceError('Doctor staff profile not found', 404);
  }

  const appointment = await careAppointmentRepo.findById(id);
  if (!appointment) throw new ServiceError('Appointment not found', 404);

  const before = { doctorStaffId: appointment.doctorStaffId };
  appointment.doctorStaffId = doctorStaffId || undefined;
  await careAppointmentRepo.saveAppointment(appointment);

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'ASSIGN_DOCTOR',
    module: 'CareAppointment',
    targetEntityType: 'CareAppointment',
    targetEntityId: appointment._id,
    beforeData: before,
    afterData: { doctorStaffId },
    req,
  });

  return careAppointmentRepo.findByIdWithPopulate(appointment._id);
};

const assignNurse = async (user, id, body, req) => {
  const { nurseStaffId } = body;
  if (nurseStaffId) {
    const staff = await staffProfileRepo.findById(nurseStaffId);
    if (!staff) throw new ServiceError('Nurse staff profile not found', 404);
  }

  const appointment = await careAppointmentRepo.findById(id);
  if (!appointment) throw new ServiceError('Appointment not found', 404);

  const before = { nurseStaffId: appointment.nurseStaffId };
  appointment.nurseStaffId = nurseStaffId || undefined;
  await careAppointmentRepo.saveAppointment(appointment);

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'ASSIGN_NURSE',
    module: 'CareAppointment',
    targetEntityType: 'CareAppointment',
    targetEntityId: appointment._id,
    beforeData: before,
    afterData: { nurseStaffId },
    req,
  });

  return careAppointmentRepo.findByIdWithPopulate(appointment._id);
};

const sendReminder = async (id) => {
  const appointment = await careAppointmentRepo.findById(id)
    .populate('residentId', 'fullName familyPortalAccountIds')
    .populate({ path: 'doctorStaffId', select: 'userId' })
    .populate({ path: 'nurseStaffId', select: 'userId' });

  if (!appointment) throw new ServiceError('Appointment not found', 404);

  const recipientIds = new Set();
  if (appointment.doctorStaffId?.userId) recipientIds.add(appointment.doctorStaffId.userId.toString());
  if (appointment.nurseStaffId?.userId) recipientIds.add(appointment.nurseStaffId.userId.toString());
  if (appointment.residentId?.familyPortalAccountIds?.length) {
    appointment.residentId.familyPortalAccountIds.forEach((id) => recipientIds.add(id.toString()));
  }

  const residentName = appointment.residentId?.fullName || 'Resident';
  const scheduledTime = appointment.scheduledStartAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  const notifications = [...recipientIds].map((userId) => ({
    recipientUserId: userId,
    category: 'appointment',
    title: 'Nhắc lịch khám',
    content: `Lịch khám cho ${residentName} vào lúc ${scheduledTime}. Loại: ${appointment.appointmentType || 'Chung'}.`,
    targetEntityType: 'CareAppointment',
    targetEntityId: appointment._id,
    deliveryChannels: ['in_app'],
  }));

  if (notifications.length > 0) {
    await notificationRepo.insertMany(notifications);
  }

  return { message: 'Reminders sent', recipientCount: notifications.length };
};

module.exports = {
  createAppointment,
  listAppointments,
  getDailySchedule,
  getWeeklySchedule,
  getAppointment,
  updateAppointment,
  deleteAppointment,
  updateStatus,
  assignDoctor,
  assignNurse,
  sendReminder,
};

const ServiceError = require('./serviceError');
const careAppointmentRepo = require('../repositories/careAppointmentRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const notificationRepo = require('../repositories/notificationRepository');
const { createAuditLog } = require('../utils/auditLog');

const VALID_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];

const RESTRICTED_ROLES = ['doctor', 'nurse'];

// doctor chỉ thấy appointment của mình qua doctorStaffId
// nurse chỉ thấy appointment của mình qua nurseStaffId
// admin / manager không bị giới hạn
const applyOwnershipFilter = (filter, user, staffProfile) => {
  if (!RESTRICTED_ROLES.includes(user.role)) return;
  if (user.role === 'doctor') filter.doctorStaffId = staffProfile._id;
  else if (user.role === 'nurse') filter.nurseStaffId = staffProfile._id;
};

// Dùng cho getAppointment (fetch by id): kiểm tra sau khi đã có document
const assertAppointmentAccess = (appointment, user, staffProfile) => {
  if (!RESTRICTED_ROLES.includes(user.role)) return;
  const myId = staffProfile._id.toString();
  const doctorMatch = user.role === 'doctor' && appointment.doctorStaffId?._id?.toString() === myId;
  const nurseMatch = user.role === 'nurse' && appointment.nurseStaffId?._id?.toString() === myId;
  if (!doctorMatch && !nurseMatch) {
    throw new ServiceError('Access denied: this appointment is not assigned to you', 403);
  }
};

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

const listAppointments = async (user, staffProfile, query) => {
  const filter = {};
  applyOwnershipFilter(filter, user, staffProfile);

  if (query.residentId) filter.residentId = query.residentId;
  if (query.status) filter.status = query.status;
  if (query.appointmentType) filter.appointmentType = query.appointmentType;
  // doctor/nurse không được override filter của chính họ qua query param
  if (!RESTRICTED_ROLES.includes(user.role)) {
    if (query.doctorStaffId) filter.doctorStaffId = query.doctorStaffId;
    if (query.nurseStaffId) filter.nurseStaffId = query.nurseStaffId;
  }
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

const getDailySchedule = async (user, staffProfile, query) => {
  const refDate = query.date ? new Date(query.date) : new Date();
  if (isNaN(refDate)) throw new ServiceError('Invalid date', 400);

  const start = new Date(refDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(refDate);
  end.setHours(23, 59, 59, 999);

  const filter = { scheduledStartAt: { $gte: start, $lte: end } };
  applyOwnershipFilter(filter, user, staffProfile);
  if (query.residentId) filter.residentId = query.residentId;

  const appointments = await careAppointmentRepo.findAppointmentsWithPopulate(filter, { sort: { scheduledStartAt: 1 } });
  return { date: start, appointments };
};

const getWeeklySchedule = async (user, staffProfile, query) => {
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
  applyOwnershipFilter(filter, user, staffProfile);
  if (query.residentId) filter.residentId = query.residentId;

  const appointments = await careAppointmentRepo.findAppointmentsWithPopulate(filter, { sort: { scheduledStartAt: 1 } });
  return { weekStart, weekEnd, appointments };
};

const getAppointment = async (user, staffProfile, id) => {
  const appointment = await careAppointmentRepo.findByIdWithPopulate(id);
  if (!appointment) throw new ServiceError('Appointment not found', 404);
  assertAppointmentAccess(appointment, user, staffProfile);
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

  if (body.doctorStaffId !== undefined) {
    if (body.doctorStaffId) {
      const doctor = await staffProfileRepo.findById(body.doctorStaffId);
      if (!doctor) throw new ServiceError('Doctor staff profile not found', 404);
    }
    appointment.doctorStaffId = body.doctorStaffId || undefined;
  }

  if (body.nurseStaffId !== undefined) {
    if (body.nurseStaffId) {
      const nurse = await staffProfileRepo.findById(body.nurseStaffId);
      if (!nurse) throw new ServiceError('Nurse staff profile not found', 404);
    }
    appointment.nurseStaffId = body.nurseStaffId || undefined;
  }

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

const REMINDER_BLOCKED_STATUSES = ['cancelled', 'completed'];

const sendReminder = async (user, id, req) => {
  const appointment = await careAppointmentRepo.findById(id)
    .populate('residentId', 'fullName familyPortalAccountIds')
    .populate({ path: 'doctorStaffId', select: 'userId' })
    .populate({ path: 'nurseStaffId', select: 'userId' });

  if (!appointment) throw new ServiceError('Appointment not found', 404);

  if (REMINDER_BLOCKED_STATUSES.includes(appointment.status)) {
    throw new ServiceError(
      `Cannot send reminder for an appointment with status "${appointment.status}"`,
      400
    );
  }

  const recipientGroups = { doctor: null, nurse: null, familyCount: 0 };
  const recipientIds = new Set();

  if (appointment.doctorStaffId?.userId) {
    const uid = appointment.doctorStaffId.userId.toString();
    recipientIds.add(uid);
    recipientGroups.doctor = uid;
  }
  if (appointment.nurseStaffId?.userId) {
    const uid = appointment.nurseStaffId.userId.toString();
    recipientIds.add(uid);
    recipientGroups.nurse = uid;
  }
  if (appointment.residentId?.familyPortalAccountIds?.length) {
    appointment.residentId.familyPortalAccountIds.forEach((fid) => {
      recipientIds.add(fid.toString());
      recipientGroups.familyCount += 1;
    });
  }

  if (recipientIds.size === 0) {
    throw new ServiceError(
      'No recipients found: appointment has no assigned doctor, nurse, or linked family accounts',
      400
    );
  }

  const residentName = appointment.residentId?.fullName || 'Resident';
  const formatTime = (date) =>
    date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

  const startStr = formatTime(appointment.scheduledStartAt);
  const endStr = formatTime(appointment.scheduledEndAt);
  const typeLabel = appointment.appointmentType || 'Chung';

  const notifications = [...recipientIds].map((userId) => ({
    recipientUserId: userId,
    category: 'appointment',
    title: 'Nhắc lịch khám',
    content: `Lịch khám cho ${residentName}: ${typeLabel} — từ ${startStr} đến ${endStr}.${appointment.notes ? ` Ghi chú: ${appointment.notes}` : ''}`,
    targetEntityType: 'CareAppointment',
    targetEntityId: appointment._id,
    deliveryChannels: ['in_app'],
  }));

  await notificationRepo.insertMany(notifications);

  await createAuditLog({
    actorUserId: user._id,
    actorRole: user.role,
    action: 'SEND_REMINDER',
    module: 'CareAppointment',
    targetEntityType: 'CareAppointment',
    targetEntityId: appointment._id,
    afterData: { recipientCount: notifications.length, recipientGroups },
    req,
  });

  return {
    message: 'Reminders sent successfully',
    recipientCount: notifications.length,
    recipients: {
      doctorNotified: !!recipientGroups.doctor,
      nurseNotified: !!recipientGroups.nurse,
      familyNotified: recipientGroups.familyCount,
    },
  };
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

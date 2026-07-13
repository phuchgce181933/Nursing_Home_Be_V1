const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const careAppointmentRepo = require('../repositories/careAppointmentRepository');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const residentRepo = require('../repositories/residentRepository');
const notificationRepo = require('../repositories/notificationRepository');
const { createAuditLog } = require('../utils/auditLog');
const CareAppointment = require('../models/careAppointment');
const shiftRepo = require('../repositories/shiftRepository');
const { getShiftStartDateTime, getShiftEndDateTime } = require('../utils/shiftTime');
const userRepo = require('../repositories/userRepository');


const VN_TZ = 'Asia/Ho_Chi_Minh';
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: VN_TZ });
const vnDow = (dateStr) => new Date(dateStr + 'T12:00:00+07:00').getUTCDay();
const addDays = (dateStr, n) =>
  new Date(new Date(dateStr + 'T12:00:00+07:00').getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);

const VALID_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];

const RESTRICTED_ROLES = ['doctor', 'nurse'];

const applyOwnershipFilter = (filter, user, staffProfile) => {
  if (!RESTRICTED_ROLES.includes(user.role)) return;
  if (user.role === 'doctor') filter.doctorStaffId = staffProfile._id;
  else if (user.role === 'nurse') filter.nurseStaffId = staffProfile._id;
};

// Handles both populated (staffProfile doc) and unpopulated (raw ObjectId) refs.
const idOf = (ref) => (ref && ref._id ? ref._id.toString() : ref ? ref.toString() : null);

const assertAppointmentAccess = (appointment, user, staffProfile) => {
  if (!RESTRICTED_ROLES.includes(user.role)) return;
  const myId = staffProfile._id.toString();
  const doctorMatch = user.role === 'doctor' && idOf(appointment.doctorStaffId) === myId;
  const nurseMatch = user.role === 'nurse' && idOf(appointment.nurseStaffId) === myId;
  if (!doctorMatch && !nurseMatch) {
    throw new ServiceError('Access denied: this appointment is not assigned to you', 403);
  }
};

const STATUS_TRANSITIONS = {
  scheduled:   ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed:   [],
  cancelled:   [],
};

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

// Rejects a staff assignment if the linked user account is deactivated or banned —
// keeps assign/create/edit in sync with what getAvailableStaffForAppointment already filters for.
const assertStaffActive = (staffProfile, roleLabel) => {
  const u = staffProfile.userId;
  if (!u || u.isActive === false || u.isBanned === true) {
    throw new ServiceError(`${roleLabel} này hiện không hoạt động hoặc đã bị khóa tài khoản`, 400);
  }
};

const assertValidObjectId = (id, fieldName) => {
  if (id !== undefined && !mongoose.Types.ObjectId.isValid(id)) {
    throw new ServiceError(`Invalid ${fieldName}`, 400);
  }
};

const validateAppointmentWindow = (start, end) => {
  if (isNaN(start) || isNaN(end)) throw new ServiceError('Invalid date format', 400);
  if (start >= end) throw new ServiceError('scheduledEndAt must be after scheduledStartAt', 400);
};

// Parses `from`/`to` query filters, validating format and ordering.
const parseDateRange = (query) => {
  const range = {};
  if (query.from) {
    const from = new Date(query.from);
    if (isNaN(from)) throw new ServiceError('Invalid "from" date format', 400);
    range.$gte = from;
  }
  if (query.to) {
    const to = new Date(query.to);
    if (isNaN(to)) throw new ServiceError('Invalid "to" date format', 400);
    range.$lte = to;
  }
  if (range.$gte && range.$lte && range.$gte > range.$lte) {
    throw new ServiceError('"from" date must be before or equal to "to" date', 400);
  }
  return range;
};

const validateStaffAvailability = async (staffProfileId, roleCategory, startAt, endAt, appointmentId = null) => {
  if (!staffProfileId) return;

  const dateStr = startAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  const workDate = new Date(dateStr + 'T00:00:00.000Z');

  // 1. Kiểm tra ca làm việc hoạt động (Active Shift)
  const shifts = await shiftRepo.findActiveShiftsForStaffOnDate(staffProfileId, workDate);
  let hasActiveShift = false;
  for (const shift of shifts) {
    const shiftStart = getShiftStartDateTime(dateStr, shift.startTime);
    const shiftEnd = getShiftEndDateTime(dateStr, shift.startTime, shift.endTime);
    if (startAt >= shiftStart && endAt <= shiftEnd) {
      hasActiveShift = true;
      break;
    }
  }

  if (!hasActiveShift) {
    const roleLabel = roleCategory === 'doctor' ? 'Bác sĩ' : 'Y tá';
    throw new ServiceError(
      `${roleLabel} không có ca làm việc hoạt động trùng khớp với khung giờ cuộc hẹn (${startAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} - ${endAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}) vào ngày ${dateStr}`,
      400
    );
  }

  // 2. Kiểm tra trùng lịch cuộc hẹn khác
  const roleField = roleCategory === 'doctor' ? 'doctorStaffId' : 'nurseStaffId';
  const query = {
    [roleField]: staffProfileId,
    status: { $ne: 'cancelled' },
    scheduledStartAt: { $lt: endAt },
    scheduledEndAt: { $gt: startAt },
  };
  if (appointmentId) {
    query._id = { $ne: appointmentId };
  }
  const conflict = await CareAppointment.findOne(query).populate('residentId', 'fullName');
  if (conflict) {
    const residentName = conflict.residentId?.fullName || 'Bệnh nhân khác';
    const roleLabel = roleCategory === 'doctor' ? 'Bác sĩ' : 'Y tá';
    throw new ServiceError(
      `${roleLabel} đã bị trùng lịch với cuộc hẹn khám của ${residentName} trong khung giờ này`,
      409
    );
  }
};

const validateClinicalExamConstraints = (start, end, appointmentType) => {
  if (appointmentType === 'Khám lâm sàng đầu vào') {
    // 1. Must be scheduled to start within 24 hours of now
    const now = new Date();
    const limit = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (start > limit) {
      throw new ServiceError('Thời gian khám lâm sàng đầu vào phải diễn ra trong vòng 24 giờ kể từ thời điểm hiện tại.', 400);
    }

    // 2. Start date and end date must be the same day
    if (start.toDateString() !== end.toDateString()) {
      throw new ServiceError('Ngày bắt đầu và ngày kết thúc của lịch khám phải là cùng một ngày.', 400);
    }

    // 3. Fixed hours (8:00 AM to 4:00 PM)
    const startHour = start.getHours();
    const startMin = start.getMinutes();
    const endHour = end.getHours();
    const endMin = end.getMinutes();

    if (startHour < 8 || (startHour === 16 && startMin > 0) || startHour > 16) {
      throw new ServiceError('Thời gian bắt đầu khám phải nằm trong khoảng từ 8h00 sáng đến 16h00 chiều.', 400);
    }
    if (endHour < 8 || (endHour === 16 && endMin > 0) || endHour > 16) {
      throw new ServiceError('Thời gian kết thúc khám phải nằm trong khoảng từ 8h00 sáng đến 16h00 chiều.', 400);
    }
  }
};

const createAppointment = async (user, body, req) => {
  const { residentId, doctorStaffId, nurseStaffId, scheduledStartAt, scheduledEndAt, appointmentType, notes } = body;
  if (!residentId || !scheduledStartAt || !scheduledEndAt) {
    throw new ServiceError('residentId, scheduledStartAt and scheduledEndAt are required', 400);
  }

  const resident = await residentRepo.findById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);
  if (resident.residencyStatus !== 'admitted') {
    throw new ServiceError(`Cannot create appointment: resident status is '${resident.residencyStatus}', must be 'admitted'`, 400);
  }

  const start = new Date(scheduledStartAt);
  const end = new Date(scheduledEndAt);
  validateAppointmentWindow(start, end);
  validateClinicalExamConstraints(start, end, appointmentType);
  if (start < new Date()) throw new ServiceError('scheduledStartAt cannot be in the past', 400);

  if (doctorStaffId) {
    const doc = await staffProfileRepo.findByIdWithUser(doctorStaffId);
    if (!doc) throw new ServiceError('Doctor staff profile not found', 404);
    if (doc.roleCategory !== 'doctor') throw new ServiceError('Assigned staff is not a doctor', 400);
    assertStaffActive(doc, 'Bác sĩ');
    await validateStaffAvailability(doctorStaffId, 'doctor', start, end);
  }

  if (nurseStaffId) {
    const nur = await staffProfileRepo.findByIdWithUser(nurseStaffId);
    if (!nur) throw new ServiceError('Nurse staff profile not found', 404);
    if (nur.roleCategory !== 'nurse') throw new ServiceError('Assigned staff is not a nurse', 400);
    assertStaffActive(nur, 'Y tá');
    await validateStaffAvailability(nurseStaffId, 'nurse', start, end);
  }

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

  if (query.residentId) {
    assertValidObjectId(query.residentId, 'residentId');
    filter.residentId = query.residentId;
  }
  if (query.status) filter.status = query.status;
  if (query.appointmentType) filter.appointmentType = query.appointmentType;
  if (!RESTRICTED_ROLES.includes(user.role)) {
    if (query.doctorStaffId) filter.doctorStaffId = query.doctorStaffId;
    if (query.nurseStaffId) filter.nurseStaffId = query.nurseStaffId;
  }
  if (query.from || query.to) {
    filter.scheduledStartAt = parseDateRange(query);
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    careAppointmentRepo.findAppointmentsWithPopulate(filter, { sort: { scheduledStartAt: -1 }, skip, limit: limitNum }),
    careAppointmentRepo.countDocuments(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

const getMyAppointments = async (user, query) => {
  const staffProfile = await staffProfileRepo.findByUserId(user._id);
  if (!staffProfile) throw new ServiceError('Staff profile not found for this account', 404);

  const roleField = staffProfile.roleCategory === 'doctor' ? 'doctorStaffId' : 'nurseStaffId';
  const filter = { [roleField]: staffProfile._id };

  if (query.status) filter.status = query.status;
  if (query.from || query.to) {
    filter.scheduledStartAt = parseDateRange(query);
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    careAppointmentRepo.findAppointmentsWithPopulate(filter, { sort: { scheduledStartAt: 1 }, skip, limit: limitNum }),
    careAppointmentRepo.countDocuments(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

const getDailySchedule = async (user, staffProfile, query) => {
  const dateStr = query.date ? query.date.slice(0, 10) : todayVN();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new ServiceError('Invalid date', 400);

  const start = new Date(dateStr + 'T00:00:00+07:00');
  const end   = new Date(dateStr + 'T23:59:59.999+07:00');

  const filter = { scheduledStartAt: { $gte: start, $lte: end } };
  applyOwnershipFilter(filter, user, staffProfile);
  if (query.residentId) {
    assertValidObjectId(query.residentId, 'residentId');
    filter.residentId = query.residentId;
  }

  const appointments = await careAppointmentRepo.findAppointmentsWithPopulate(filter, { sort: { scheduledStartAt: 1 } });
  return { date: start, appointments };
};

const getWeeklySchedule = async (user, staffProfile, query) => {
  const dateStr = query.date ? query.date.slice(0, 10) : todayVN();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new ServiceError('Invalid date', 400);

  const dow = vnDow(dateStr);
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const mondayStr = addDays(dateStr, mondayOffset);
  const sundayStr = addDays(mondayStr, 6);

  const weekStart = new Date(mondayStr + 'T00:00:00+07:00');
  const weekEnd   = new Date(sundayStr + 'T23:59:59.999+07:00');

  const filter = { scheduledStartAt: { $gte: weekStart, $lte: weekEnd } };
  applyOwnershipFilter(filter, user, staffProfile);
  if (query.residentId) {
    assertValidObjectId(query.residentId, 'residentId');
    filter.residentId = query.residentId;
  }

  const appointments = await careAppointmentRepo.findAppointmentsWithPopulate(filter, { sort: { scheduledStartAt: 1 } });
  return { weekStart, weekEnd, appointments };
};

const getAppointment = async (user, staffProfile, id) => {
  const appointment = await careAppointmentRepo.findByIdWithPopulate(id);
  if (!appointment) throw new ServiceError('Appointment not found', 404);
  assertAppointmentAccess(appointment, user, staffProfile);
  return appointment;
};

const updateAppointment = async (user, staffProfile, id, body, req) => {
  const appointment = await careAppointmentRepo.findById(id);
  if (!appointment) throw new ServiceError('Appointment not found', 404);
  assertAppointmentAccess(appointment, user, staffProfile);

  if (['completed', 'cancelled'].includes(appointment.status)) {
    throw new ServiceError(`Cannot edit appointment with status '${appointment.status}'`, 400);
  }

  const start = body.scheduledStartAt ? new Date(body.scheduledStartAt) : appointment.scheduledStartAt;
  const end = body.scheduledEndAt ? new Date(body.scheduledEndAt) : appointment.scheduledEndAt;
  const apptType = body.appointmentType || appointment.appointmentType;
  validateAppointmentWindow(start, end);
  validateClinicalExamConstraints(start, end, apptType);
  // Only block when the start time is actually being moved into the past —
  // resaving an unchanged (already-past) time (e.g. editing notes only) is allowed.
  if (start.getTime() !== appointment.scheduledStartAt.getTime() && start < new Date()) {
    throw new ServiceError('scheduledStartAt cannot be in the past', 400);
  }

  const conflict = await careAppointmentRepo.findOneConflict(appointment.residentId, start, end, appointment._id);
  if (conflict) throw new ServiceError('Schedule conflict detected', 409);

  let docId = appointment.doctorStaffId;
  if (body.doctorStaffId !== undefined) {
    if (body.doctorStaffId) {
      const doctor = await staffProfileRepo.findByIdWithUser(body.doctorStaffId);
      if (!doctor) throw new ServiceError('Doctor staff profile not found', 404);
      if (doctor.roleCategory !== 'doctor') throw new ServiceError('Assigned staff is not a doctor', 400);
      assertStaffActive(doctor, 'Bác sĩ');
    }
    docId = body.doctorStaffId || null;
  }
  if (docId) {
    await validateStaffAvailability(docId, 'doctor', start, end, appointment._id);
  }
  appointment.doctorStaffId = docId || undefined;

  let nurId = appointment.nurseStaffId;
  if (body.nurseStaffId !== undefined) {
    if (body.nurseStaffId) {
      const nurse = await staffProfileRepo.findByIdWithUser(body.nurseStaffId);
      if (!nurse) throw new ServiceError('Nurse staff profile not found', 404);
      if (nurse.roleCategory !== 'nurse') throw new ServiceError('Assigned staff is not a nurse', 400);
      assertStaffActive(nurse, 'Y tá');
    }
    nurId = body.nurseStaffId || null;
  }
  if (nurId) {
    await validateStaffAvailability(nurId, 'nurse', start, end, appointment._id);
  }
  appointment.nurseStaffId = nurId || undefined;

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

const deleteAppointment = async (user, staffProfile, id, req) => {
  const appointment = await careAppointmentRepo.findById(id);
  if (!appointment) throw new ServiceError('Appointment not found', 404);
  assertAppointmentAccess(appointment, user, staffProfile);

  if (['in_progress', 'completed'].includes(appointment.status)) {
    throw new ServiceError(`Cannot delete an appointment with status '${appointment.status}'`, 400);
  }

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

const updateStatus = async (user, staffProfile, id, body, req) => {
  const { status } = body;
  if (!status || !VALID_STATUSES.includes(status)) {
    throw new ServiceError(`status must be one of: ${VALID_STATUSES.join(', ')}`, 400);
  }

  const appointment = await careAppointmentRepo.findById(id);
  if (!appointment) throw new ServiceError('Appointment not found', 404);
  assertAppointmentAccess(appointment, user, staffProfile);

  if (appointment.appointmentType === 'Khám lâm sàng đầu vào' && ['in_progress', 'completed'].includes(status)) {
    if (!appointment.doctorStaffId || !appointment.nurseStaffId) {
      throw new ServiceError('Yêu cầu chỉ định bắt buộc phải đủ cả bác sĩ và y tá trước khi thực hiện khám.', 400);
    }
  }

  const allowedNext = STATUS_TRANSITIONS[appointment.status];
  if (!allowedNext.includes(status)) {
    const hint = allowedNext.length ? allowedNext.join(', ') : 'none (terminal status)';
    throw new ServiceError(
      `Cannot transition from '${appointment.status}' to '${status}'. Allowed: ${hint}`,
      400
    );
  }

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

  const appointment = await careAppointmentRepo.findById(id);
  if (!appointment) throw new ServiceError('Appointment not found', 404);

  if (['completed', 'cancelled'].includes(appointment.status)) {
    throw new ServiceError(`Cannot reassign staff on a '${appointment.status}' appointment`, 400);
  }

  if (doctorStaffId) {
    const staff = await staffProfileRepo.findByIdWithUser(doctorStaffId);
    if (!staff) throw new ServiceError('Doctor staff profile not found', 404);
    if (staff.roleCategory !== 'doctor') throw new ServiceError('Assigned staff is not a doctor', 400);
    assertStaffActive(staff, 'Bác sĩ');
    await validateStaffAvailability(doctorStaffId, 'doctor', appointment.scheduledStartAt, appointment.scheduledEndAt, appointment._id);
  }

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

  const appointment = await careAppointmentRepo.findById(id);
  if (!appointment) throw new ServiceError('Appointment not found', 404);

  if (['completed', 'cancelled'].includes(appointment.status)) {
    throw new ServiceError(`Cannot reassign staff on a '${appointment.status}' appointment`, 400);
  }

  if (nurseStaffId) {
    const staff = await staffProfileRepo.findByIdWithUser(nurseStaffId);
    if (!staff) throw new ServiceError('Nurse staff profile not found', 404);
    if (staff.roleCategory !== 'nurse') throw new ServiceError('Assigned staff is not a nurse', 400);
    assertStaffActive(staff, 'Y tá');
    await validateStaffAvailability(nurseStaffId, 'nurse', appointment.scheduledStartAt, appointment.scheduledEndAt, appointment._id);
  }

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

const sendReminder = async (user, id, req) => {
  const appointment = await careAppointmentRepo.findById(id)
    .populate('residentId', 'fullName familyPortalAccountIds')
    .populate({ path: 'doctorStaffId', select: 'userId' })
    .populate({ path: 'nurseStaffId', select: 'userId' });

  if (!appointment) throw new ServiceError('Appointment not found', 404);

  if (appointment.status !== 'scheduled') {
    throw new ServiceError(`Reminders can only be sent for 'scheduled' appointments`, 400);
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
    date.toLocaleString('vi-VN', { timeZone: VN_TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

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

const getAvailableStaffForAppointment = async (user, query) => {
  const { start, end, appointmentId } = query;
  if (!start || !end) {
    throw new ServiceError('start and end query parameters are required', 400);
  }

  const startAt = new Date(start);
  const endAt = new Date(end);
  validateAppointmentWindow(startAt, endAt);

  // Lấy tất cả staff doctor và nurse đang hoạt động
  const staffUsers = await userRepo.findStaffUsers(
    { role: { $in: ['doctor', 'nurse'] }, isActive: true, isBanned: false },
    { skip: 0, limit: 1000 }
  );

  const staffUserMap = Object.fromEntries(staffUsers.map(u => [u._id.toString(), u]));
  const userIds = staffUsers.map(u => u._id);
  const profiles = await staffProfileRepo.findByUserIdList(userIds);

  const doctors = [];
  const nurses = [];

  for (const profile of profiles) {
    const u = staffUserMap[profile.userId.toString()];
    if (!u) continue;

    try {
      // validateStaffAvailability throws if staff is not active on shift or has an appointment overlap
      await validateStaffAvailability(profile._id, u.role, startAt, endAt, appointmentId || null);
      
      const staffInfo = {
        _id: profile._id,
        fullName: u.fullName,
        role: u.role,
        specialty: profile.specialty || '',
      };

      if (u.role === 'doctor') {
        doctors.push(staffInfo);
      } else if (u.role === 'nurse') {
        nurses.push(staffInfo);
      }
    } catch (err) {
      // Skip staff who are unavailable (no shift or overlap conflict)
    }
  }

  return { doctors, nurses };
};

module.exports = {
  createAppointment,
  listAppointments,
  getMyAppointments,
  getDailySchedule,
  getWeeklySchedule,
  getAppointment,
  updateAppointment,
  deleteAppointment,
  updateStatus,
  assignDoctor,
  assignNurse,
  sendReminder,
  getAvailableStaffForAppointment,
};

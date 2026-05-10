const CareAppointment = require('../models/careAppointment');
const StaffProfile = require('../models/staffProfile');
const Notification = require('../models/notification');
const { createAuditLog } = require('../utils/auditLog');

const checkConflict = async (residentId, startAt, endAt, excludeId = null) => {
  const query = {
    residentId,
    status: { $ne: 'cancelled' },
    scheduledStartAt: { $lt: endAt },
    scheduledEndAt: { $gt: startAt },
  };
  if (excludeId) query._id = { $ne: excludeId };
  return CareAppointment.findOne(query);
};

const populateAppointment = (query) =>
  query
    .populate('residentId', 'fullName residentCode')
    .populate({ path: 'doctorStaffId', populate: { path: 'userId', select: 'fullName' } })
    .populate({ path: 'nurseStaffId', populate: { path: 'userId', select: 'fullName' } });

const createAppointment = async (req, res) => {
  try {
    const { residentId, doctorStaffId, nurseStaffId, scheduledStartAt, scheduledEndAt, appointmentType, notes } = req.body;

    if (!residentId || !scheduledStartAt || !scheduledEndAt) {
      return res.status(400).json({ message: 'residentId, scheduledStartAt and scheduledEndAt are required' });
    }

    const start = new Date(scheduledStartAt);
    const end = new Date(scheduledEndAt);
    if (isNaN(start) || isNaN(end)) return res.status(400).json({ message: 'Invalid date format' });
    if (start >= end) return res.status(400).json({ message: 'scheduledEndAt must be after scheduledStartAt' });

    const conflict = await checkConflict(residentId, start, end);
    if (conflict) {
      return res.status(409).json({ message: 'Schedule conflict: resident already has an appointment in this time slot', conflictId: conflict._id });
    }

    const appointment = await CareAppointment.create({
      residentId,
      doctorStaffId: doctorStaffId || undefined,
      nurseStaffId: nurseStaffId || undefined,
      scheduledStartAt: start,
      scheduledEndAt: end,
      appointmentType,
      notes,
    });

    await createAuditLog({
      actorUserId: req.user._id,
      actorRole: req.user.role,
      action: 'CREATE',
      module: 'CareAppointment',
      targetEntityType: 'CareAppointment',
      targetEntityId: appointment._id,
      afterData: appointment.toObject(),
      req,
    });

    const populated = await populateAppointment(CareAppointment.findById(appointment._id));
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const listAppointments = async (req, res) => {
  try {
    const { residentId, status, appointmentType, doctorStaffId, nurseStaffId, from, to, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (residentId) filter.residentId = residentId;
    if (status) filter.status = status;
    if (appointmentType) filter.appointmentType = appointmentType;
    if (doctorStaffId) filter.doctorStaffId = doctorStaffId;
    if (nurseStaffId) filter.nurseStaffId = nurseStaffId;
    if (from || to) {
      filter.scheduledStartAt = {};
      if (from) filter.scheduledStartAt.$gte = new Date(from);
      if (to) filter.scheduledStartAt.$lte = new Date(to);
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      populateAppointment(CareAppointment.find(filter).sort({ scheduledStartAt: -1 }).skip(skip).limit(limitNum)),
      CareAppointment.countDocuments(filter),
    ]);

    res.json({ data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getDailySchedule = async (req, res) => {
  try {
    const { date, residentId } = req.query;
    const refDate = date ? new Date(date) : new Date();
    if (isNaN(refDate)) return res.status(400).json({ message: 'Invalid date' });

    const start = new Date(refDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(refDate);
    end.setHours(23, 59, 59, 999);

    const filter = { scheduledStartAt: { $gte: start, $lte: end } };
    if (residentId) filter.residentId = residentId;

    const appointments = await populateAppointment(CareAppointment.find(filter).sort({ scheduledStartAt: 1 }));
    res.json({ date: start, appointments });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getWeeklySchedule = async (req, res) => {
  try {
    const { date, residentId } = req.query;
    const refDate = date ? new Date(date) : new Date();
    if (isNaN(refDate)) return res.status(400).json({ message: 'Invalid date' });

    const dow = refDate.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const weekStart = new Date(refDate);
    weekStart.setDate(refDate.getDate() + mondayOffset);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const filter = { scheduledStartAt: { $gte: weekStart, $lte: weekEnd } };
    if (residentId) filter.residentId = residentId;

    const appointments = await populateAppointment(CareAppointment.find(filter).sort({ scheduledStartAt: 1 }));
    res.json({ weekStart, weekEnd, appointments });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getAppointment = async (req, res) => {
  try {
    const appointment = await populateAppointment(CareAppointment.findById(req.params.id));
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    res.json(appointment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateAppointment = async (req, res) => {
  try {
    const appointment = await CareAppointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    const { scheduledStartAt, scheduledEndAt, appointmentType, notes } = req.body;

    const start = scheduledStartAt ? new Date(scheduledStartAt) : appointment.scheduledStartAt;
    const end = scheduledEndAt ? new Date(scheduledEndAt) : appointment.scheduledEndAt;

    if (start >= end) return res.status(400).json({ message: 'scheduledEndAt must be after scheduledStartAt' });

    const conflict = await checkConflict(appointment.residentId, start, end, appointment._id);
    if (conflict) {
      return res.status(409).json({ message: 'Schedule conflict detected', conflictId: conflict._id });
    }

    const before = appointment.toObject();
    appointment.scheduledStartAt = start;
    appointment.scheduledEndAt = end;
    if (appointmentType !== undefined) appointment.appointmentType = appointmentType;
    if (notes !== undefined) appointment.notes = notes;
    await appointment.save();

    await createAuditLog({
      actorUserId: req.user._id,
      actorRole: req.user.role,
      action: 'UPDATE',
      module: 'CareAppointment',
      targetEntityType: 'CareAppointment',
      targetEntityId: appointment._id,
      beforeData: before,
      afterData: appointment.toObject(),
      req,
    });

    const populated = await populateAppointment(CareAppointment.findById(appointment._id));
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deleteAppointment = async (req, res) => {
  try {
    const appointment = await CareAppointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    const before = appointment.toObject();
    await appointment.deleteOne();

    await createAuditLog({
      actorUserId: req.user._id,
      actorRole: req.user.role,
      action: 'DELETE',
      module: 'CareAppointment',
      targetEntityType: 'CareAppointment',
      targetEntityId: before._id,
      beforeData: before,
      req,
    });

    res.json({ message: 'Appointment deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['scheduled', 'in_progress', 'completed', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${validStatuses.join(', ')}` });
    }

    const appointment = await CareAppointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    const prevStatus = appointment.status;
    appointment.status = status;
    await appointment.save();

    await createAuditLog({
      actorUserId: req.user._id,
      actorRole: req.user.role,
      action: 'UPDATE_STATUS',
      module: 'CareAppointment',
      targetEntityType: 'CareAppointment',
      targetEntityId: appointment._id,
      beforeData: { status: prevStatus },
      afterData: { status },
      req,
    });

    res.json(appointment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const assignDoctor = async (req, res) => {
  try {
    const { doctorStaffId } = req.body;

    if (doctorStaffId) {
      const staff = await StaffProfile.findById(doctorStaffId);
      if (!staff) return res.status(404).json({ message: 'Doctor staff profile not found' });
    }

    const appointment = await CareAppointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    const before = { doctorStaffId: appointment.doctorStaffId };
    appointment.doctorStaffId = doctorStaffId || undefined;
    await appointment.save();

    await createAuditLog({
      actorUserId: req.user._id,
      actorRole: req.user.role,
      action: 'ASSIGN_DOCTOR',
      module: 'CareAppointment',
      targetEntityType: 'CareAppointment',
      targetEntityId: appointment._id,
      beforeData: before,
      afterData: { doctorStaffId },
      req,
    });

    const populated = await populateAppointment(CareAppointment.findById(appointment._id));
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const assignNurse = async (req, res) => {
  try {
    const { nurseStaffId } = req.body;

    if (nurseStaffId) {
      const staff = await StaffProfile.findById(nurseStaffId);
      if (!staff) return res.status(404).json({ message: 'Nurse staff profile not found' });
    }

    const appointment = await CareAppointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    const before = { nurseStaffId: appointment.nurseStaffId };
    appointment.nurseStaffId = nurseStaffId || undefined;
    await appointment.save();

    await createAuditLog({
      actorUserId: req.user._id,
      actorRole: req.user.role,
      action: 'ASSIGN_NURSE',
      module: 'CareAppointment',
      targetEntityType: 'CareAppointment',
      targetEntityId: appointment._id,
      beforeData: before,
      afterData: { nurseStaffId },
      req,
    });

    const populated = await populateAppointment(CareAppointment.findById(appointment._id));
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const sendReminder = async (req, res) => {
  try {
    const appointment = await CareAppointment.findById(req.params.id)
      .populate('residentId', 'fullName familyPortalAccountIds')
      .populate({ path: 'doctorStaffId', select: 'userId' })
      .populate({ path: 'nurseStaffId', select: 'userId' });

    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    const recipientIds = new Set();

    if (appointment.doctorStaffId?.userId) recipientIds.add(appointment.doctorStaffId.userId.toString());
    if (appointment.nurseStaffId?.userId) recipientIds.add(appointment.nurseStaffId.userId.toString());

    if (appointment.residentId?.familyPortalAccountIds?.length) {
      appointment.residentId.familyPortalAccountIds.forEach(id => recipientIds.add(id.toString()));
    }

    const residentName = appointment.residentId?.fullName || 'Resident';
    const scheduledTime = appointment.scheduledStartAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

    const notifications = [...recipientIds].map(userId => ({
      recipientUserId: userId,
      category: 'appointment',
      title: 'Nhắc lịch khám',
      content: `Lịch khám cho ${residentName} vào lúc ${scheduledTime}. Loại: ${appointment.appointmentType || 'Chung'}.`,
      targetEntityType: 'CareAppointment',
      targetEntityId: appointment._id,
      deliveryChannels: ['in_app'],
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
    }

    res.json({ message: 'Reminders sent', recipientCount: notifications.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
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

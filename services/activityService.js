const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const activityRepo = require('../repositories/activityRepository');
const notificationRepo = require('../repositories/notificationRepository');
const Resident = require('../models/resident');
const { ACTIVITY_STATUSES } = require('../models/enums');
const { calculateDurationMinutes } = require('../utils/activityDuration');

const VALID_ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'left_early'];
const VALID_PARTICIPATION_LEVELS = ['active', 'partial', 'passive'];
const MANUAL_ACTIVITY_STATUSES = ['draft', 'scheduled', 'completed', 'cancelled'];

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const normalizeObjectIds = (value) => {
  if (!value) return [];
  const toObjectId = (id) => new mongoose.Types.ObjectId(id);
  if (!Array.isArray(value)) return [toObjectId(value)];
  return [...new Set(value.map((id) => toObjectId(id).toString()))].map((id) => new mongoose.Types.ObjectId(id));
};

const buildFilterFromQuery = (query) => {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.category) filter.category = query.category;
  if (query.organizerStaffId) filter.organizerStaffId = query.organizerStaffId;
  if (query.participantResidentIds) filter.participantResidentIds = { $in: query.participantResidentIds };
  else if (query.participantResidentId) filter.participantResidentIds = query.participantResidentId;
  if (query.search) {
    const search = query.search.trim();
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
    ];
  }
  if (query.from || query.to) {
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    const conditions = [];

    if (from && to) {
      conditions.push({ scheduledAt: { $gte: from, $lte: to } });
      conditions.push({ endAt: { $gte: from, $lte: to } });
      conditions.push({ $and: [{ scheduledAt: { $lte: from } }, { endAt: { $gte: to } }] });
    } else if (from) {
      conditions.push({ scheduledAt: { $gte: from } });
      conditions.push({ endAt: { $gte: from } });
      conditions.push({ scheduledAt: { $lte: from } });
    } else if (to) {
      conditions.push({ scheduledAt: { $lte: to } });
      conditions.push({ endAt: { $lte: to } });
      conditions.push({ endAt: { $gte: to } });
    }

    if (conditions.length) {
      filter.$or = conditions;
    }
  }
  return filter;
};

const validateActivityTimeRange = (startDate, endDate) => {
  const now = new Date();
  if (Number.isNaN(startDate.getTime())) {
    throw new ServiceError('startAt must be a valid date', 400);
  }
  if (startDate < now) {
    throw new ServiceError('startAt cannot be in the past', 400);
  }

  if (Number.isNaN(endDate.getTime())) {
    throw new ServiceError('endAt must be a valid date', 400);
  }
  if (endDate <= startDate) {
    throw new ServiceError('endAt must be later than startAt', 400);
  }
};

const normalizeAttendanceRecords = (records) => {
  if (!Array.isArray(records)) {
    throw new ServiceError('attendanceRecords must be an array', 400);
  }

  return records.map((record) => {
    const residentId = record?.residentId;
    if (!residentId || !mongoose.Types.ObjectId.isValid(residentId)) {
      throw new ServiceError('attendanceRecords must contain valid residentId values', 400);
    }

    const status = String(record?.status || '').trim().toLowerCase();
    if (!VALID_ATTENDANCE_STATUSES.includes(status)) {
      throw new ServiceError(`attendance status must be one of: ${VALID_ATTENDANCE_STATUSES.join(', ')}`, 400);
    }

    return {
      residentId: new mongoose.Types.ObjectId(residentId),
      status,
      note: typeof record?.note === 'string' ? record.note.trim() : '',
    };
  });
};

const normalizeParticipationRecords = (records) => {
  if (!Array.isArray(records)) {
    throw new ServiceError('participationRecords must be an array', 400);
  }

  return records.map((record) => {
    const residentId = record?.residentId;
    if (!residentId || !mongoose.Types.ObjectId.isValid(residentId)) {
      throw new ServiceError('participationRecords must contain valid residentId values', 400);
    }

    const participationLevel = String(record?.participationLevel || '').trim().toLowerCase();
    if (!VALID_PARTICIPATION_LEVELS.includes(participationLevel)) {
      throw new ServiceError(`participation level must be one of: ${VALID_PARTICIPATION_LEVELS.join(', ')}`, 400);
    }

    return {
      residentId: new mongoose.Types.ObjectId(residentId),
      participationLevel,
      comment: typeof record?.comment === 'string' ? record.comment.trim() : '',
      incident: typeof record?.incident === 'string' ? record.incident.trim() : '',
    };
  });
};

const syncActivityStatusIfNeeded = async (activity, now = new Date()) => {
  if (!activity) return activity;

  const currentStatus = String(activity.status || '').trim().toLowerCase();
  if (!currentStatus || currentStatus === 'draft' || currentStatus === 'cancelled' || currentStatus === 'completed') {
    return activity;
  }

  const startAt = activity.startAt || activity.scheduledAt;
  const endAt = activity.endAt || activity.startAt || activity.scheduledAt;
  if (!startAt || !endAt) return activity;

  const startDate = new Date(startAt);
  const endDate = new Date(endAt);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return activity;

  let nextStatus = currentStatus;
  if (now < startDate) {
    nextStatus = 'scheduled';
  } else if (now >= startDate && now <= endDate) {
    nextStatus = 'ongoing';
  } else if (now > endDate) {
    nextStatus = 'completed';
  }

  if (nextStatus !== currentStatus) {
    const updated = await activityRepo.findByIdAndUpdate(activity._id, { status: nextStatus });
    return updated || activity;
  }

  return activity;
};

const getParticipantFamilyUserIds = async (residentIds = []) => {
  if (!residentIds || residentIds.length === 0) return [];
  const residents = await Resident.find(
    { _id: { $in: residentIds } },
    'familyPortalAccountIds'
  ).lean();
  const userIds = new Set();
  residents.forEach((resident) => {
    resident.familyPortalAccountIds?.forEach((userId) => userIds.add(userId.toString()));
  });
  return [...userIds];
};

const sendActivityNotifications = async (activity, action, message, extraResidentIds = []) => {
  const residentIds = [...new Set([...(Array.isArray(activity.participantResidentIds) ? activity.participantResidentIds : []), ...extraResidentIds.map((id) => new mongoose.Types.ObjectId(id))].map((id) => id.toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const recipientUserIds = await getParticipantFamilyUserIds(residentIds);
  if (!recipientUserIds.length) return;

  const notifications = recipientUserIds.map((recipientUserId) => ({
    recipientUserId,
    category: 'activity',
    title: (() => {
      switch (action) {
        case 'scheduled': return `Hoạt động mới: ${activity.title}`;
        case 'updated': return `Hoạt động đã được cập nhật: ${activity.title}`;
        case 'cancelled': return `Hoạt động đã bị hủy: ${activity.title}`;
        case 'registration': return `Đăng ký hoạt động: ${activity.title}`;
        case 'completed': return `Hoạt động hoàn thành: ${activity.title}`;
        default: return `${activity.title}`;
      }
    })(),
    content: message,
    targetEntityType: 'Activity',
    targetEntityId: activity._id,
    deliveryChannels: ['in_app'],
    sentAt: new Date(),
  }));

  await notificationRepo.insertMany(notifications);
};

const createActivity = async (body) => {
  if (!body || typeof body !== 'object') {
    throw new ServiceError('Request body is required', 400);
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const location = typeof body.location === 'string' ? body.location.trim() : '';
  const status = typeof body.status === 'string' ? body.status.trim() : 'scheduled';
  const requestedDailyMinutes = body.dailyDurationMinutes !== undefined && body.dailyDurationMinutes !== '' && body.dailyDurationMinutes !== null
    ? Number(body.dailyDurationMinutes)
    : null;

  if (!title) throw new ServiceError('title is required', 400);
  if (title.length > 100) throw new ServiceError('title must be at most 100 characters', 400);
  if (description && description.length > 1000) throw new ServiceError('description must be at most 1000 characters', 400);
  if (category && category.length > 100) throw new ServiceError('category must be at most 100 characters', 400);
  if (location && location.length > 200) throw new ServiceError('location must be at most 200 characters', 400);

  const startInput = body.startAt ?? body.scheduledAt;
  const endInput = body.endAt ?? body.scheduledAt ?? body.startAt;
  if (!startInput) throw new ServiceError('startAt is required', 400);

  const scheduledAt = new Date(startInput);
  const endAt = new Date(endInput);
  validateActivityTimeRange(scheduledAt, endAt);

  const computedDurationMinutes = calculateDurationMinutes(scheduledAt, endAt);
  if (computedDurationMinutes === null) {
    throw new ServiceError('startAt and endAt must be valid dates', 400);
  }
  if (computedDurationMinutes < 1) {
    throw new ServiceError('endAt must be later than startAt', 400);
  }

  const shouldCreateRecurring = Boolean(body.createRecurring) || (requestedDailyMinutes !== null && endAt.getTime() - scheduledAt.getTime() > 24 * 60 * 60 * 1000);
  const recurringDailyDurationMinutes = requestedDailyMinutes !== null ? requestedDailyMinutes : (computedDurationMinutes < 60 ? 30 : computedDurationMinutes);
  if (shouldCreateRecurring && recurringDailyDurationMinutes < 1) {
    throw new ServiceError('dailyDurationMinutes must be greater than 0', 400);
  }

  if (body.organizerStaffId && !mongoose.Types.ObjectId.isValid(body.organizerStaffId)) {
    throw new ServiceError('organizerStaffId must be a valid ObjectId', 400);
  }

  if (body.organizerStaffId) {
    const User = require('../models/user');
    const organizer = await User.findById(body.organizerStaffId);
    if (!organizer) {
      throw new ServiceError('Organizer staff not found', 404);
    }
    const role = String(organizer.role || '').toLowerCase();
    const isNurse = role.includes('nurse') || role.includes('y tá') || role.includes('điều dưỡng');
    if (!isNurse) {
      throw new ServiceError('Activity organizer must be a nurse', 400);
    }
  }

  if (body.participantResidentIds !== undefined) {
    if (!Array.isArray(body.participantResidentIds)) {
      throw new ServiceError('participantResidentIds must be an array', 400);
    }

    if (body.participantResidentIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      throw new ServiceError('participantResidentIds must contain valid ObjectIds', 400);
    }
  }

  if (!ACTIVITY_STATUSES.includes(status)) {
    throw new ServiceError(`status must be one of: ${ACTIVITY_STATUSES.join(', ')}`, 400);
  }

  if (shouldCreateRecurring) {
    const createdActivities = [];
    const currentDay = new Date(scheduledAt);
    currentDay.setHours(0, 0, 0, 0);
    const lastDay = new Date(endAt);
    lastDay.setHours(0, 0, 0, 0);

    for (let day = new Date(currentDay); day <= lastDay; day.setDate(day.getDate() + 1)) {
      const occurrenceStart = new Date(day);
      occurrenceStart.setHours(scheduledAt.getHours(), scheduledAt.getMinutes(), 0, 0);
      const occurrenceEnd = new Date(occurrenceStart.getTime() + recurringDailyDurationMinutes * 60 * 1000);

      const activity = await activityRepo.create({
        title,
        category: category || undefined,
        description: description || undefined,
        scheduledAt: occurrenceStart,
        endAt: occurrenceEnd,
        durationMinutes: recurringDailyDurationMinutes,
        location: location || undefined,
        organizerStaffId: body.organizerStaffId || undefined,
        participantResidentIds: normalizeObjectIds(body.participantResidentIds),
        status,
      });

      createdActivities.push(activity);
      await sendActivityNotifications(
        activity,
        'scheduled',
        `Hoạt động mới: ${activity.title} đã được lên lịch vào ${activity.scheduledAt.toLocaleString('vi-VN')}${activity.location ? ` tại ${activity.location}` : ''}.`,
      );
    }

    return { message: 'Activities created for each day', createdCount: createdActivities.length, data: createdActivities };
  }

  const activity = await activityRepo.create({
    title,
    category: category || undefined,
    description: description || undefined,
    scheduledAt,
    endAt,
    durationMinutes: computedDurationMinutes,
    location: location || undefined,
    organizerStaffId: body.organizerStaffId || undefined,
    participantResidentIds: normalizeObjectIds(body.participantResidentIds),
    status,
  });

  await sendActivityNotifications(
    activity,
    'scheduled',
    `Hoạt động mới: ${activity.title} đã được lên lịch vào ${activity.scheduledAt.toLocaleString('vi-VN')}${activity.location ? ` tại ${activity.location}` : ''}.`,
  );

  return activity;
};

const listActivities = async (query) => {
  const filter = buildFilterFromQuery(query);
  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    activityRepo.find(filter, { sort: { scheduledAt: 1 }, skip, limit: limitNum }),
    activityRepo.count(filter),
  ]);
  const syncedData = await Promise.all(data.map((activity) => syncActivityStatusIfNeeded(activity)));
  return { data: syncedData, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

const getActivityById = async (activityId) => {
  const activity = await activityRepo.findById(activityId);
  if (!activity) throw new ServiceError('Activity not found', 404);
  return syncActivityStatusIfNeeded(activity);
};

const updateActivity = async (activityId, body) => {
  const update = {};
  if (body.title !== undefined) update.title = body.title.trim();
  if (body.category !== undefined) update.category = body.category?.trim();
  if (body.description !== undefined) update.description = body.description?.trim();
  if (body.startAt !== undefined || body.scheduledAt !== undefined) {
    update.scheduledAt = new Date(body.startAt ?? body.scheduledAt);
  }
  if (body.endAt !== undefined || body.scheduledAt !== undefined) {
    update.endAt = new Date(body.endAt ?? body.startAt ?? body.scheduledAt);
  }
  if (body.startAt !== undefined || body.scheduledAt !== undefined || body.endAt !== undefined) {
    const startDate = body.startAt ? new Date(body.startAt) : update.scheduledAt;
    const endDate = body.endAt ? new Date(body.endAt) : update.endAt;
    validateActivityTimeRange(startDate, endDate);
    const computedDurationMinutes = calculateDurationMinutes(startDate, endDate);
    if (computedDurationMinutes === null) {
      throw new ServiceError('startAt and endAt must be valid dates', 400);
    }
    if (computedDurationMinutes < 1) {
      throw new ServiceError('endAt must be later than startAt', 400);
    }
    update.durationMinutes = computedDurationMinutes;
  }
  if (body.location !== undefined) update.location = body.location?.trim();
  if (body.organizerStaffId !== undefined) {
    if (body.organizerStaffId) {
      const User = require('../models/user');
      const organizer = await User.findById(body.organizerStaffId);
      if (!organizer) {
        throw new ServiceError('Organizer staff not found', 404);
      }
      const role = String(organizer.role || '').toLowerCase();
      const isNurse = role.includes('nurse') || role.includes('y tá') || role.includes('điều dưỡng');
      if (!isNurse) {
        throw new ServiceError('Activity organizer must be a nurse', 400);
      }
    }
    update.organizerStaffId = body.organizerStaffId;
  }
  if (body.status !== undefined) {
    if (body.status === 'ongoing') {
      throw new ServiceError('Activity status ongoing is managed automatically', 400);
    }
    if (!MANUAL_ACTIVITY_STATUSES.includes(body.status)) {
      throw new ServiceError(`status must be one of: ${MANUAL_ACTIVITY_STATUSES.join(', ')}`, 400);
    }
    update.status = body.status;
  }
  if (body.participantResidentIds !== undefined) update.participantResidentIds = normalizeObjectIds(body.participantResidentIds);

  const updated = await activityRepo.findByIdAndUpdate(activityId, update);
  if (!updated) throw new ServiceError('Activity not found', 404);

  await sendActivityNotifications(
    updated,
    'updated',
    `Hoạt động đã được cập nhật.`,
  );

  return updated;
};

const deleteActivity = async (activityId) => {
  const activity = await activityRepo.findByIdAndUpdate(activityId, { status: 'cancelled' });
  if (!activity) throw new ServiceError('Activity not found', 404);

  await sendActivityNotifications(
    activity,
    'cancelled',
    `Hoạt động đã bị hủy.`,
  );

  await activityRepo.deleteById(activityId);
  return { message: 'Activity deleted successfully' };
};

const bulkDeleteActivities = async (query = {}) => {
  const filter = buildFilterFromQuery(query);
  const deleted = await activityRepo.deleteMany(filter);
  return { deletedCount: deleted.deletedCount || 0, message: 'Activities deleted successfully' };
};

const bulkUpdateActivityStatus = async (query = {}, status) => {
  if (!status) {
    throw new ServiceError('status is required', 400);
  }

  if (status === 'ongoing') {
    throw new ServiceError('Activity status ongoing is managed automatically', 400);
  }

  if (!MANUAL_ACTIVITY_STATUSES.includes(status)) {
    throw new ServiceError(`status must be one of: ${MANUAL_ACTIVITY_STATUSES.join(', ')}`, 400);
  }

  const filter = buildFilterFromQuery(query);
  const updated = await activityRepo.updateMany(filter, { status });
  return { modifiedCount: updated.modifiedCount || 0, message: 'Activities status updated successfully' };
};

const setParticipantList = async (activityId, participantResidentIds) => {
  if (!Array.isArray(participantResidentIds)) {
    throw new ServiceError('participantResidentIds must be an array', 400);
  }

  const participants = normalizeObjectIds(participantResidentIds);
  const activity = await activityRepo.findByIdAndUpdate(activityId, { participantResidentIds: participants });
  if (!activity) throw new ServiceError('Activity not found', 404);

  await sendActivityNotifications(
    activity,
    'updated',
    `Danh sách người tham gia hoạt động đã được cập nhật.`,
  );

  return activity;
};

const registerResident = async (activityId, residentId) => {
  if (!residentId) throw new ServiceError('residentId is required', 400);
  const activity = await activityRepo.findById(activityId);
  if (!activity) throw new ServiceError('Activity not found', 404);

  const resident = await Resident.findById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);
  if (resident.residencyStatus !== 'admitted') {
    throw new ServiceError('Resident is not currently admitted', 400);
  }

  const normalizedResidentId = new mongoose.Types.ObjectId(residentId);
  const existing = activity.participantResidentIds?.map((id) => id.toString()) || [];
  if (existing.includes(normalizedResidentId.toString())) {
    throw new ServiceError('Resident already registered for this activity', 400);
  }

  const updatedParticipants = [...existing, normalizedResidentId];
  activity.participantResidentIds = updatedParticipants;
  await activity.save();

  await sendActivityNotifications(
    activity,
    'registration',
    `Đã thêm cư dân vào hoạt động.`,
    [normalizedResidentId],
  );

  return activity;
};

const recordParticipationResult = async (activityId, body) => {
  const activity = await activityRepo.findById(activityId);
  if (!activity) throw new ServiceError('Activity not found', 404);

  const syncedActivity = await syncActivityStatusIfNeeded(activity);
  const now = new Date();
  const activityStatus = String(syncedActivity.status || '').trim().toLowerCase();
  if (activityStatus === 'draft') {
    throw new ServiceError('Chỉ có thể điểm danh khi hoạt động đã được lên lịch', 400);
  }

  const activityStart = new Date(syncedActivity.startAt || syncedActivity.scheduledAt);
  const activityEnd = new Date(syncedActivity.endAt || syncedActivity.startAt || syncedActivity.scheduledAt);
  if (Number.isNaN(activityStart.getTime()) || Number.isNaN(activityEnd.getTime())) {
    throw new ServiceError('Activity time window is invalid', 400);
  }
  if (now < activityStart || now > activityEnd) {
    throw new ServiceError('Chỉ có thể điểm danh khi hoạt động đã được lên lịch và đang diễn ra', 400);
  }

  const updates = {};
  if (body.participantResultNotes !== undefined) updates.participantResultNotes = body.participantResultNotes?.trim();
  if (body.status !== undefined) {
    if (body.status === 'ongoing') {
      throw new ServiceError('Activity status ongoing is managed automatically', 400);
    }
    if (!MANUAL_ACTIVITY_STATUSES.includes(body.status)) {
      throw new ServiceError(`status must be one of: ${MANUAL_ACTIVITY_STATUSES.join(', ')}`, 400);
    }
    updates.status = body.status;
  }
  if (body.attendanceRecords !== undefined) updates.attendanceRecords = normalizeAttendanceRecords(body.attendanceRecords);
  if (body.participationRecords !== undefined) updates.participationRecords = normalizeParticipationRecords(body.participationRecords);
  if (Object.keys(updates).length === 0) {
    throw new ServiceError('At least one field is required to record participation results', 400);
  }

  const updated = await activityRepo.findByIdAndUpdate(activityId, updates);
  await sendActivityNotifications(
    updated,
    'completed',
    `Participation results have been recorded for this activity.`,
  );

  return updated;
};

const getActivityStatistics = async (query) => {
  const filter = buildFilterFromQuery(query);
  const [totalActivities, statusGroups, categoryGroups, participantSummary, attendanceSummary] = await Promise.all([
    activityRepo.count(filter),
    activityRepo.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    activityRepo.aggregate([
      { $match: filter },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),
    activityRepo.aggregate([
      { $match: filter },
      {
        $project: {
          participantCount: { $size: { $ifNull: ['$participantResidentIds', []] } },
        },
      },
      { $group: { _id: null, totalParticipants: { $sum: '$participantCount' } } },
    ]),
    activityRepo.aggregate([
      { $match: filter },
      { $unwind: { path: '$attendanceRecords', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          attendedCount: {
            $cond: [
              {
                $in: [
                  '$attendanceRecords.status',
                  ['present', 'late', 'left_early'],
                ],
              },
              1,
              0,
            ],
          },
        },
      },
      { $group: { _id: null, totalAttendance: { $sum: '$attendedCount' } } },
    ]),
  ]);

  const totalParticipants = participantSummary[0]?.totalParticipants || 0;
  const totalAttendance = attendanceSummary[0]?.totalAttendance || 0;
  const participationRate = totalParticipants > 0
    ? Math.round((totalAttendance / totalParticipants) * 100)
    : 0;

  return {
    totalActivities,
    statusCounts: statusGroups.reduce((acc, group) => ({ ...acc, [group._id || 'unknown']: group.count }), {}),
    categoryCounts: categoryGroups.reduce((acc, group) => ({ ...acc, [group._id || 'uncategorized']: group.count }), {}),
    totalParticipants,
    participationRate,
  };
};

const getActivityStatisticsById = async (activityId) => {
  const activity = await activityRepo.findById(activityId);
  if (!activity) throw new ServiceError('Activity not found', 404);

  return {
    activityId: activity._id,
    title: activity.title,
    status: activity.status,
    category: activity.category,
    scheduledAt: activity.scheduledAt,
    location: activity.location,
    durationMinutes: activity.durationMinutes,
    totalParticipants: activity.participantResidentIds?.length || 0,
    participantResidentIds: activity.participantResidentIds,
    participantResultNotes: activity.participantResultNotes,
  };
};

module.exports = {
  createActivity,
  listActivities,
  getActivityById,
  updateActivity,
  deleteActivity,
  bulkDeleteActivities,
  bulkUpdateActivityStatus,
  setParticipantList,
  registerResident,
  recordParticipationResult,
  getActivityStatistics,
  getActivityStatisticsById,
};

const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const activityRepo = require('../repositories/activityRepository');
const notificationRepo = require('../repositories/notificationRepository');
const Resident = require('../models/resident');

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
  if (query.participantResidentId) filter.participantResidentIds = query.participantResidentId;
  if (query.search) {
    const search = query.search.trim();
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
    ];
  }
  if (query.from || query.to) {
    filter.scheduledAt = {};
    if (query.from) filter.scheduledAt.$gte = new Date(query.from);
    if (query.to) filter.scheduledAt.$lte = new Date(query.to);
  }
  return filter;
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
    title: `Activity ${action}: ${activity.title}`,
    content: message,
    targetEntityType: 'Activity',
    targetEntityId: activity._id,
    deliveryChannels: ['in_app'],
    sentAt: new Date(),
  }));

  await notificationRepo.insertMany(notifications);
};

const createActivity = async (body) => {
  if (!body.title) throw new ServiceError('title is required', 400);
  if (!body.scheduledAt) throw new ServiceError('scheduledAt is required', 400);

  const activity = await activityRepo.create({
    title: body.title.trim(),
    category: body.category?.trim(),
    description: body.description?.trim(),
    scheduledAt: new Date(body.scheduledAt),
    durationMinutes: body.durationMinutes,
    location: body.location?.trim(),
    organizerStaffId: body.organizerStaffId,
    participantResidentIds: normalizeObjectIds(body.participantResidentIds),
    status: body.status || 'scheduled',
  });

  await sendActivityNotifications(
    activity,
    'scheduled',
    `A new activity has been scheduled for ${activity.scheduledAt.toISOString()}${activity.location ? ` at ${activity.location}` : ''}.`,
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
  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

const getActivityById = async (activityId) => {
  const activity = await activityRepo.findById(activityId);
  if (!activity) throw new ServiceError('Activity not found', 404);
  return activity;
};

const updateActivity = async (activityId, body) => {
  const update = {};
  if (body.title !== undefined) update.title = body.title.trim();
  if (body.category !== undefined) update.category = body.category?.trim();
  if (body.description !== undefined) update.description = body.description?.trim();
  if (body.scheduledAt !== undefined) update.scheduledAt = new Date(body.scheduledAt);
  if (body.durationMinutes !== undefined) update.durationMinutes = body.durationMinutes;
  if (body.location !== undefined) update.location = body.location?.trim();
  if (body.organizerStaffId !== undefined) update.organizerStaffId = body.organizerStaffId;
  if (body.status !== undefined) update.status = body.status;
  if (body.participantResidentIds !== undefined) update.participantResidentIds = normalizeObjectIds(body.participantResidentIds);

  const updated = await activityRepo.findByIdAndUpdate(activityId, update);
  if (!updated) throw new ServiceError('Activity not found', 404);

  await sendActivityNotifications(
    updated,
    'updated',
    `The activity has been updated. Scheduled time: ${updated.scheduledAt.toISOString()}.`,
  );

  return updated;
};

const deleteActivity = async (activityId) => {
  const activity = await activityRepo.findByIdAndUpdate(activityId, { status: 'cancelled' });
  if (!activity) throw new ServiceError('Activity not found', 404);

  await sendActivityNotifications(
    activity,
    'cancelled',
    `The activity has been cancelled.`,
  );

  await activityRepo.deleteById(activityId);
  return { message: 'Activity deleted successfully' };
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
    `The participant list has been updated for this activity.`,
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
    `A resident has been registered for the activity.`,
    [normalizedResidentId],
  );

  return activity;
};

const recordParticipationResult = async (activityId, body) => {
  const activity = await activityRepo.findById(activityId);
  if (!activity) throw new ServiceError('Activity not found', 404);

  const updates = {};
  if (body.participantResultNotes !== undefined) updates.participantResultNotes = body.participantResultNotes?.trim();
  if (body.status !== undefined) updates.status = body.status;
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
  const [totalActivities, statusGroups, categoryGroups, participantSummary] = await Promise.all([
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
  ]);

  return {
    totalActivities,
    statusCounts: statusGroups.reduce((acc, group) => ({ ...acc, [group._id || 'unknown']: group.count }), {}),
    categoryCounts: categoryGroups.reduce((acc, group) => ({ ...acc, [group._id || 'uncategorized']: group.count }), {}),
    totalParticipants: participantSummary[0]?.totalParticipants || 0,
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
  setParticipantList,
  registerResident,
  recordParticipationResult,
  getActivityStatistics,
  getActivityStatisticsById,
};

const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const activityRepo = require('../repositories/activityRepository');
const notificationService = require('./notificationService');
const Resident = require('../models/resident');
const User = require('../models/user');
const { ACTIVITY_STATUSES } = require('../models/enums');
const { calculateDurationMinutes } = require('../utils/activityDuration');

const VALID_ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'left_early'];
const VALID_PARTICIPATION_LEVELS = ['active', 'partial', 'passive'];
const MANUAL_ACTIVITY_STATUSES = ['draft', 'scheduled', 'completed', 'cancelled'];
const ALLOWED_ACTIVITY_STAFF_ROLE_KEYWORDS = ['nurse', 'y tá', 'điều dưỡng', 'caregiver', 'hộ lý', 'doctor', 'bác sĩ'];
const ALLOWED_ACTIVITY_CATEGORY_OPTIONS = [
  'Hoạt động chăm sóc cá nhân hằng ngày',
  'Hoạt động chăm sóc sức khỏe',
  'Hoạt động ăn uống - dinh dưỡng',
  'Hoạt động thể chất - phục hồi chức năng',
  'Hoạt động giải trí',
  'Hoạt động kích thích nhận thức',
  'Hoạt động xã hội - giao lưu',
  'Hoạt động tâm lý - tinh thần',
  'Hoạt động sự kiện đặc biệt',
  'Hoạt động với gia đình',
  'Hoạt động quản lý nội bộ',
  'Hoạt động xử lý sự cố',
];

const normalizeActivityCategory = (body) => {
  const selectedCategory = typeof body.category === 'string' ? body.category.trim() : '';
  if (!selectedCategory) {
    throw new ServiceError('category is required', 400);
  }

  if (selectedCategory === 'Khác') {
    const customCategory = typeof body.categoryOther === 'string' ? body.categoryOther.trim() : '';
    if (!customCategory) {
      throw new ServiceError('custom category is required when category is Khác', 400);
    }
    return customCategory;
  }

  if (!ALLOWED_ACTIVITY_CATEGORY_OPTIONS.includes(selectedCategory)) {
    throw new ServiceError(`category must be one of: ${ALLOWED_ACTIVITY_CATEGORY_OPTIONS.join(', ')}, Khác`, 400);
  }

  return selectedCategory;
};

const isAllowedActivityStaffRole = (role) => {
  const roleText = String(role || '').toLowerCase();
  return ALLOWED_ACTIVITY_STAFF_ROLE_KEYWORDS.some((keyword) => roleText.includes(keyword));
};

const normalizeStaffIdList = (value) => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined && item !== null && item !== '').map((item) => String(item));
  }
  return [String(value)];
};

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
  if (query.organizerStaffIds) filter.organizerStaffIds = { $in: [query.organizerStaffIds] };
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

const MAX_NOTE_LENGTH = 500;

const assertNoDuplicateResidentIds = (records, label) => {
  const seen = new Set();
  for (const r of records) {
    const key = r.residentId.toString();
    if (seen.has(key)) {
      throw new ServiceError(`${label} contains duplicate residentId ${key}`, 400);
    }
    seen.add(key);
  }
};

const assertResidentsAreParticipants = (records, participantIds, label) => {
  const allowed = new Set((participantIds || []).map((id) => id.toString()));
  for (const r of records) {
    if (!allowed.has(r.residentId.toString())) {
      throw new ServiceError(`${label}: resident ${r.residentId} is not a participant of this activity`, 400);
    }
  }
};

const normalizeAttendanceRecords = (records) => {
  if (!Array.isArray(records)) {
    throw new ServiceError('attendanceRecords must be an array', 400);
  }

  const normalized = records.map((record) => {
    const residentId = record?.residentId;
    if (!residentId || !mongoose.Types.ObjectId.isValid(residentId)) {
      throw new ServiceError('attendanceRecords must contain valid residentId values', 400);
    }

    const status = String(record?.status || '').trim().toLowerCase();
    if (!VALID_ATTENDANCE_STATUSES.includes(status)) {
      throw new ServiceError(`attendance status must be one of: ${VALID_ATTENDANCE_STATUSES.join(', ')}`, 400);
    }

    const note = typeof record?.note === 'string' ? record.note.trim() : '';
    if (note.length > MAX_NOTE_LENGTH) {
      throw new ServiceError(`note must be at most ${MAX_NOTE_LENGTH} characters`, 400);
    }
    const occurrenceDate = record?.occurrenceDate ? new Date(record.occurrenceDate) : null;

    return {
      residentId: new mongoose.Types.ObjectId(residentId),
      occurrenceDate: occurrenceDate && !Number.isNaN(occurrenceDate.getTime()) ? occurrenceDate : undefined,
      status,
      note,
    };
  });

  assertNoDuplicateResidentIds(normalized, 'attendanceRecords');
  return normalized;
};

const normalizeParticipationRecords = (records) => {
  if (!Array.isArray(records)) {
    throw new ServiceError('participationRecords must be an array', 400);
  }

  const normalized = records.map((record) => {
    const residentId = record?.residentId;
    if (!residentId || !mongoose.Types.ObjectId.isValid(residentId)) {
      throw new ServiceError('participationRecords must contain valid residentId values', 400);
    }

    const participationLevel = String(record?.participationLevel || '').trim().toLowerCase();
    if (!VALID_PARTICIPATION_LEVELS.includes(participationLevel)) {
      throw new ServiceError(`participation level must be one of: ${VALID_PARTICIPATION_LEVELS.join(', ')}`, 400);
    }

    const comment = typeof record?.comment === 'string' ? record.comment.trim() : '';
    const incident = typeof record?.incident === 'string' ? record.incident.trim() : '';
    if (comment.length > MAX_NOTE_LENGTH || incident.length > MAX_NOTE_LENGTH) {
      throw new ServiceError(`comment/incident must be at most ${MAX_NOTE_LENGTH} characters`, 400);
    }
    const occurrenceDate = record?.occurrenceDate ? new Date(record.occurrenceDate) : null;

    return {
      residentId: new mongoose.Types.ObjectId(residentId),
      occurrenceDate: occurrenceDate && !Number.isNaN(occurrenceDate.getTime()) ? occurrenceDate : undefined,
      participationLevel,
      comment,
      incident,
    };
  });

  assertNoDuplicateResidentIds(normalized, 'participationRecords');
  return normalized;
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
    if (updated) {
      await sendActivityNotifications(
        updated,
        'status_update',
        `Trạng thái hoạt động đã được cập nhật thành ${getActivityStatusLabel(nextStatus)}.`,
      );
    }
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

const getAdminUserIds = async () => {
  const admins = await User.find({ role: 'admin', isActive: true, isBanned: false }).select('_id').lean();
  return admins.map((user) => user._id.toString());
};

const getActivityStatusLabel = (status) => {
  switch (status) {
    case 'scheduled': return 'đã lên lịch';
    case 'ongoing': return 'đang diễn ra';
    case 'completed': return 'đã hoàn thành';
    case 'cancelled': return 'đã bị hủy';
    case 'draft': return 'bản nháp';
    default: return status || 'cập nhật';
  }
};

const buildActivityChangeSummary = (previousActivity, currentActivity) => {
  const previousStatus = String(previousActivity?.status || '').trim().toLowerCase();
  const currentStatus = String(currentActivity?.status || '').trim().toLowerCase();
  const previousParticipants = (previousActivity?.participantResidentIds || []).map((id) => String(id));
  const currentParticipants = (currentActivity?.participantResidentIds || []).map((id) => String(id));

  const changes = [];

  if (previousStatus !== currentStatus) {
    changes.push(`trạng thái đổi từ ${getActivityStatusLabel(previousStatus)} sang ${getActivityStatusLabel(currentStatus)}`);
  }

  const addedParticipants = currentParticipants.filter((id) => !previousParticipants.includes(id));
  const removedParticipants = previousParticipants.filter((id) => !currentParticipants.includes(id));
  if (addedParticipants.length || removedParticipants.length) {
    const participantChanges = [];
    if (addedParticipants.length) participantChanges.push(`thêm ${addedParticipants.length} người tham gia`);
    if (removedParticipants.length) participantChanges.push(`bớt ${removedParticipants.length} người tham gia`);
    changes.push(participantChanges.join(' và '));
  }

  return {
    hasChanges: changes.length > 0,
    changes,
  };
};

const buildActivityNotificationPayload = (activity, action, message, isAdminRecipient = false, previousActivity = null) => {
  const status = String(activity?.status || '').trim().toLowerCase();
  const statusLabel = getActivityStatusLabel(status);
  const changeSummary = buildActivityChangeSummary(previousActivity, activity);
  const detailSuffix = changeSummary.hasChanges
    ? ` Cập nhật: ${changeSummary.changes.join(' và ')}.`
    : '';

  if (status === 'completed') {
    return {
      title: isAdminRecipient ? `Hoạt động ${statusLabel}: ${activity.title}` : `Hoạt động đã hoàn thành: ${activity.title}`,
      content: (isAdminRecipient
        ? `Admin vừa đánh dấu hoạt động "${activity.title}" là ${statusLabel}.`
        : message || `Hoạt động "${activity.title}" đã hoàn thành.`) + detailSuffix,
    };
  }

  if (status === 'cancelled') {
    return {
      title: isAdminRecipient ? `Hoạt động ${statusLabel}: ${activity.title}` : `Hoạt động đã bị hủy: ${activity.title}`,
      content: (isAdminRecipient
        ? `Admin vừa đánh dấu hoạt động "${activity.title}" là ${statusLabel}.`
        : message || `Hoạt động "${activity.title}" đã bị hủy.`) + detailSuffix,
    };
  }

  if (status === 'ongoing') {
    return {
      title: isAdminRecipient ? `Hoạt động ${statusLabel}: ${activity.title}` : `Hoạt động đang diễn ra: ${activity.title}`,
      content: (isAdminRecipient
        ? `Admin vừa cập nhật hoạt động "${activity.title}" sang trạng thái ${statusLabel}.`
        : message || `Hoạt động "${activity.title}" đang diễn ra.`) + detailSuffix,
    };
  }

  if (status === 'scheduled') {
    const title = isAdminRecipient
      ? `Hoạt động ${statusLabel}: ${activity.title}`
      : (action === 'updated'
        ? `Hoạt động đã được cập nhật: ${activity.title}`
        : action === 'registration'
          ? `Đăng ký hoạt động: ${activity.title}`
          : `Hoạt động mới: ${activity.title}`);

    const baseContent = isAdminRecipient
      ? `Admin vừa ${action === 'updated' ? 'cập nhật' : action === 'registration' ? 'đăng ký' : 'tạo'} hoạt động "${activity.title}".`
      : message || `Hoạt động "${activity.title}" đã được lên lịch.`;

    return { title, content: `${baseContent}${detailSuffix}`.trim() };
  }

  return {
    title: isAdminRecipient ? `Hoạt động ${statusLabel}: ${activity.title}` : `${activity.title}`,
    content: `${message || `Hoạt động "${activity.title}" có trạng thái ${statusLabel}.`}${detailSuffix}`.trim(),
  };
};

const sendActivityNotifications = async (activity, action, message, extraResidentIds = [], previousActivity = null) => {
  const residentIds = [...new Set([...(Array.isArray(activity.participantResidentIds) ? activity.participantResidentIds : []), ...extraResidentIds.map((id) => new mongoose.Types.ObjectId(id))].map((id) => id.toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const recipientUserIds = await getParticipantFamilyUserIds(residentIds);
  const adminUserIds = await getAdminUserIds();
  const uniqueRecipientUserIds = [...new Set([...recipientUserIds, ...adminUserIds])];
  if (!uniqueRecipientUserIds.length) return;

  const notifications = uniqueRecipientUserIds.map((recipientUserId) => {
    const isAdminRecipient = adminUserIds.includes(recipientUserId);
    const payload = buildActivityNotificationPayload(activity, action, message, isAdminRecipient, previousActivity);

    return {
      recipientUserId,
      category: 'activity',
      title: payload.title,
      content: payload.content,
      targetEntityType: 'Activity',
      targetEntityId: activity._id,
      deliveryChannels: ['in_app'],
      sentAt: new Date(),
    };
  });

  await notificationService.createMany(notifications);
};

const createActivity = async (body) => {
  if (!body || typeof body !== 'object') {
    throw new ServiceError('Request body is required', 400);
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = normalizeActivityCategory(body);
  const location = typeof body.location === 'string' ? body.location.trim() : '';
  const status = typeof body.status === 'string' ? body.status.trim() : 'scheduled';
  const organizerStaffIds = normalizeStaffIdList(body.organizerStaffIds ?? body.organizerStaffId);
  const supportStaffIds = normalizeStaffIdList(body.supportStaffIds ?? body.supportStaffId);
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
    throw new ServiceError('Thời lượng mỗi ngày phải lớn hơn 0 phút', 400);
  }
  // Validate daily duration does not exceed 24 hours
  const MAX_DAILY_MINUTES = 24 * 60;
  if (requestedDailyMinutes !== null && requestedDailyMinutes > MAX_DAILY_MINUTES) {
    throw new ServiceError('Thời lượng mỗi ngày không được vượt quá 24 giờ', 400);
  }

  if (body.organizerStaffId && !mongoose.Types.ObjectId.isValid(body.organizerStaffId)) {
    throw new ServiceError('organizerStaffId must be a valid ObjectId', 400);
  }

  if (organizerStaffIds.length) {
    if (organizerStaffIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      throw new ServiceError('organizerStaffIds must contain valid ObjectIds', 400);
    }

    const User = require('../models/user');
    for (const organizerId of organizerStaffIds) {
      const organizer = await User.findById(organizerId);
      if (!organizer) {
        throw new ServiceError('Organizer staff not found', 404);
      }
      if (!isAllowedActivityStaffRole(organizer.role)) {
        throw new ServiceError('Activity organizer must be a nurse, caregiver, hộ lý, or doctor', 400);
      }
    }
  }

  if (supportStaffIds.length) {
    if (supportStaffIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      throw new ServiceError('supportStaffIds must contain valid ObjectIds', 400);
    }

    const User = require('../models/user');
    for (const supportStaffId of supportStaffIds) {
      const supportStaff = await User.findById(supportStaffId);
      if (!supportStaff) {
        throw new ServiceError('Support staff not found', 404);
      }
      if (!isAllowedActivityStaffRole(supportStaff.role)) {
        throw new ServiceError('Support staff must be a nurse, caregiver, hộ lý, or doctor', 400);
      }
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
        organizerStaffId: organizerStaffIds[0] || undefined,
        organizerStaffIds: organizerStaffIds.map((id) => new mongoose.Types.ObjectId(id)),
        supportStaffId: supportStaffIds[0] || undefined,
        supportStaffIds: supportStaffIds.map((id) => new mongoose.Types.ObjectId(id)),
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
    organizerStaffId: organizerStaffIds[0] || undefined,
    organizerStaffIds: organizerStaffIds.map((id) => new mongoose.Types.ObjectId(id)),
    supportStaffId: supportStaffIds[0] || undefined,
    supportStaffIds: supportStaffIds.map((id) => new mongoose.Types.ObjectId(id)),
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
  if (body.category !== undefined) update.category = normalizeActivityCategory(body);
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
  // support updating dailyDurationMinutes for recurring activities
  if (body.dailyDurationMinutes !== undefined) {
    const dd = body.dailyDurationMinutes === '' || body.dailyDurationMinutes === null ? null : Number(body.dailyDurationMinutes);
    if (dd !== null && (!Number.isFinite(dd) || dd < 1)) {
      throw new ServiceError('Thời lượng mỗi ngày phải là số dương', 400);
    }
    const MAX_DAILY_MINUTES = 24 * 60;
    if (dd !== null && dd > MAX_DAILY_MINUTES) {
      throw new ServiceError('Thời lượng mỗi ngày không được vượt quá 24 giờ', 400);
    }
    if (dd !== null) update.dailyDurationMinutes = dd;
  }
  if (body.location !== undefined) update.location = body.location?.trim();
  if (body.organizerStaffIds !== undefined || body.organizerStaffId !== undefined) {
    const organizerStaffIds = normalizeStaffIdList(body.organizerStaffIds ?? body.organizerStaffId);
    if (organizerStaffIds.length) {
      if (organizerStaffIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
        throw new ServiceError('organizerStaffIds must contain valid ObjectIds', 400);
      }
      const User = require('../models/user');
      for (const organizerId of organizerStaffIds) {
        const organizer = await User.findById(organizerId);
        if (!organizer) {
          throw new ServiceError('Organizer staff not found', 404);
        }
        if (!isAllowedActivityStaffRole(organizer.role)) {
          throw new ServiceError('Activity organizer must be a nurse, caregiver, hộ lý, or doctor', 400);
        }
      }
    }
    update.organizerStaffIds = organizerStaffIds.map((id) => new mongoose.Types.ObjectId(id));
    update.organizerStaffId = organizerStaffIds[0] || null;
  }

  if (body.supportStaffIds !== undefined || body.supportStaffId !== undefined) {
    const supportStaffIds = normalizeStaffIdList(body.supportStaffIds ?? body.supportStaffId);
    if (supportStaffIds.length) {
      if (supportStaffIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
        throw new ServiceError('supportStaffIds must contain valid ObjectIds', 400);
      }
      const User = require('../models/user');
      for (const supportStaffId of supportStaffIds) {
        const supportStaff = await User.findById(supportStaffId);
        if (!supportStaff) {
          throw new ServiceError('Support staff not found', 404);
        }
        if (!isAllowedActivityStaffRole(supportStaff.role)) {
          throw new ServiceError('Support staff must be a nurse, caregiver, hộ lý, or doctor', 400);
        }
      }
    }
    update.supportStaffIds = supportStaffIds.map((id) => new mongoose.Types.ObjectId(id));
    update.supportStaffId = supportStaffIds[0] || null;
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

  const previousActivity = await activityRepo.findById(activityId);
  const updated = await activityRepo.findByIdAndUpdate(activityId, update);
  if (!updated) throw new ServiceError('Activity not found', 404);

  await sendActivityNotifications(
    updated,
    'updated',
    `Hoạt động đã được cập nhật.`,
    [],
    previousActivity,
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
  if (participants.length) {
    const residents = await Resident.find({ _id: { $in: participants } }, 'residencyStatus').lean();
    const foundIds = new Set(residents.map((r) => r._id.toString()));
    const missing = participants.filter((id) => !foundIds.has(id.toString()));
    if (missing.length) {
      throw new ServiceError(`Residents not found: ${missing.join(', ')}`, 404);
    }
    const notAdmitted = residents.filter((r) => r.residencyStatus !== 'admitted').map((r) => r._id.toString());
    if (notAdmitted.length) {
      throw new ServiceError(`Residents are not currently admitted: ${notAdmitted.join(', ')}`, 400);
    }
  }

  const activity = await activityRepo.findByIdAndUpdate(activityId, { participantResidentIds: participants });
  if (!activity) throw new ServiceError('Activity not found', 404);

  await sendActivityNotifications(
    activity,
    'updated',
    `Danh sách người tham gia hoạt động đã được cập nhật.`,
  );

  return activity;
};

const assertActivityOpenForRegistration = (activity) => {
  const status = String(activity.status || '').trim().toLowerCase();
  if (status === 'cancelled' || status === 'completed') {
    throw new ServiceError(`Cannot register: this activity is already ${status}`, 400);
  }
  const startAt = new Date(activity.startAt || activity.scheduledAt);
  if (!Number.isNaN(startAt.getTime()) && new Date() > startAt) {
    throw new ServiceError('Cannot register: this activity has already started', 400);
  }
};

const registerResident = async (activityId, residentId, currentUser) => {
  if (!residentId) throw new ServiceError('residentId is required', 400);
  const activity = await activityRepo.findById(activityId);
  if (!activity) throw new ServiceError('Activity not found', 404);

  const resident = await Resident.findById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);
  if (resident.residencyStatus !== 'admitted') {
    throw new ServiceError('Resident is not currently admitted', 400);
  }
  if (currentUser?.role === 'family') {
    const ownedIds = (resident.familyPortalAccountIds || []).map((id) => id.toString());
    if (!ownedIds.includes(String(currentUser._id))) {
      throw new ServiceError('Access denied: not your relative', 403);
    }
  }

  assertActivityOpenForRegistration(activity);

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

const unregisterResident = async (activityId, residentId, currentUser) => {
  if (!residentId) throw new ServiceError('residentId is required', 400);
  const activity = await activityRepo.findById(activityId);
  if (!activity) throw new ServiceError('Activity not found', 404);

  const resident = await Resident.findById(residentId);
  if (!resident) throw new ServiceError('Resident not found', 404);
  if (currentUser?.role === 'family') {
    const ownedIds = (resident.familyPortalAccountIds || []).map((id) => id.toString());
    if (!ownedIds.includes(String(currentUser._id))) {
      throw new ServiceError('Access denied: not your relative', 403);
    }
  }

  const status = String(activity.status || '').trim().toLowerCase();
  if (status === 'completed') {
    throw new ServiceError('Cannot cancel registration: this activity has already completed', 400);
  }

  const normalizedResidentId = String(residentId);
  const existing = activity.participantResidentIds?.map((id) => id.toString()) || [];
  if (!existing.includes(normalizedResidentId)) {
    throw new ServiceError('Resident is not registered for this activity', 400);
  }

  activity.participantResidentIds = activity.participantResidentIds.filter(
    (id) => id.toString() !== normalizedResidentId
  );
  await activity.save();

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
  // Allow a grace window after the activity ends so nurses can still record attendance
  // shortly after it concludes (the activity auto-flips to 'completed' right at activityEnd).
  const RECORD_GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours
  if (now < activityStart || now > new Date(activityEnd.getTime() + RECORD_GRACE_MS)) {
    throw new ServiceError('Chỉ có thể điểm danh khi hoạt động đã hoặc đang diễn ra (trong vòng 2 giờ sau khi kết thúc)', 400);
  }

  const updates = {};
  if (body.participantResultNotes !== undefined) {
    const trimmed = body.participantResultNotes?.trim();
    if (trimmed && trimmed.length > MAX_NOTE_LENGTH) {
      throw new ServiceError(`participantResultNotes must be at most ${MAX_NOTE_LENGTH} characters`, 400);
    }
    updates.participantResultNotes = trimmed;
  }
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

  const participantIds = syncedActivity.participantResidentIds || [];
  if (updates.attendanceRecords) {
    assertResidentsAreParticipants(updates.attendanceRecords, participantIds, 'attendanceRecords');
  }
  if (updates.participationRecords) {
    assertResidentsAreParticipants(updates.participationRecords, participantIds, 'participationRecords');
  }

  // Merge attendance/participation records by occurrenceDate + residentId instead of replacing whole arrays
  const existing = await activityRepo.findById(activityId);
  if (!existing) throw new ServiceError('Activity not found', 404);

  if (updates.attendanceRecords) {
    const mapKey = (rec) => `${rec.residentId.toString()}|${rec.occurrenceDate ? new Date(rec.occurrenceDate).toISOString().slice(0,10) : 'none'}`;
    const merged = [];
    const existingMap = new Map((existing.attendanceRecords || []).map((r) => [mapKey(r), r]));
    (updates.attendanceRecords || []).forEach((r) => existingMap.set(mapKey(r), r));
    existingMap.forEach((v) => merged.push(v));
    updates.attendanceRecords = merged;
  }

  if (updates.participationRecords) {
    const mapKey = (rec) => `${rec.residentId.toString()}|${rec.occurrenceDate ? new Date(rec.occurrenceDate).toISOString().slice(0,10) : 'none'}`;
    const merged = [];
    const existingMap = new Map((existing.participationRecords || []).map((r) => [mapKey(r), r]));
    (updates.participationRecords || []).forEach((r) => existingMap.set(mapKey(r), r));
    existingMap.forEach((v) => merged.push(v));
    updates.participationRecords = merged;
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
  buildActivityNotificationPayload,
  createActivity,
  listActivities,
  getActivityById,
  updateActivity,
  deleteActivity,
  bulkDeleteActivities,
  bulkUpdateActivityStatus,
  setParticipantList,
  registerResident,
  unregisterResident,
  recordParticipationResult,
  getActivityStatistics,
  getActivityStatisticsById,
};

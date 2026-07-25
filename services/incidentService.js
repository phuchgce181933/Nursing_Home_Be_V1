const mongoose = require('mongoose');
const Resident = require('../models/resident');
const StaffProfile = require('../models/staffProfile');
const User = require('../models/user');
const incidentRepo = require('../repositories/incidentRepository');
const notificationService = require('./notificationService');
const mailService = require('./mailService');
const ServiceError = require('./serviceError');
const { ensureStaffProfileForUser } = require('./staffProfileBootstrap');
const CareTask = require('../models/careTask');
const CareAppointment = require('../models/careAppointment');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

const parsePagination = (query) => {
  const page = Math.max(1, Number.parseInt(query.page || DEFAULT_PAGE, 10));
  const limit = Math.max(1, Number.parseInt(query.limit || DEFAULT_LIMIT, 10));

  return { page, limit, skip: (page - 1) * limit };
};

const getIncidentFilter = async (query, currentUser = null) => {
  const filter = {};

  if (query.search) {
    const escaped = String(query.search).trim();
    if (escaped) {
      filter.$or = [
        { incidentType: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
        { location: { $regex: escaped, $options: 'i' } },
        { reporterName: { $regex: escaped, $options: 'i' } },
      ];
    }
  }

  if (query.status) filter.status = query.status;
  if (query.severity) filter.severity = query.severity;
  if (query.incidentType) filter.incidentType = query.incidentType;
  if (query.residentId) {
    const residentQuery = { $or: [{ residentId: query.residentId }, { residentIds: query.residentId }] };
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, residentQuery];
      delete filter.$or;
    } else {
      filter.$and = [residentQuery];
    }
  }
  if (query.reporterRole) filter.reporterRole = query.reporterRole;

  if (query.incidentFrom || query.incidentTo) {
    filter.incidentAt = {};
    if (query.incidentFrom) filter.incidentAt.$gte = new Date(query.incidentFrom);
    if (query.incidentTo) filter.incidentAt.$lte = new Date(`${query.incidentTo}T23:59:59.999Z`);
  }

  const staffAccessFilter = await buildStaffAccessFilter(currentUser);
  if (staffAccessFilter) {
    filter.$and = [...(Array.isArray(filter.$and) ? filter.$and : []), staffAccessFilter];
  }

  return filter;
};

const getSort = (query) => {
  const sortBy = query.sortBy || 'incidentAt';
  const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
  return { [sortBy]: sortOrder };
};

const getReporterDetails = (user, override = {}) => ({
  reporterName: override.reporterName || user.fullName || 'Unknown reporter',
  reporterEmail: override.reporterEmail || user.email || undefined,
  reporterPhone: override.reporterPhone || user.phone || undefined,
  reporterRole: override.reporterRole || user.role || undefined,
});

const isCaregiverRole = (role) => {
  const normalized = String(role || '').toLowerCase();
  return normalized === 'caregiver'
    || normalized.includes('caregiver')
    || normalized.includes('care giver')
    || normalized.includes('chăm sóc');
};

const isStaffRole = (role) => {
  const normalized = String(role || '').toLowerCase();
  return ['doctor', 'nurse', 'caregiver', 'pharmacist'].includes(normalized);
};

const getStaffProfileIdForUser = async (currentUser) => {
  if (!currentUser?._id || !isStaffRole(currentUser.role)) return null;
  const profile = await StaffProfile.findOne({ userId: currentUser._id }).select('_id').lean();
  return profile?._id || null;
};

const buildStaffAccessFilter = async (currentUser) => {
  if (!currentUser || currentUser.role === 'admin') return null;

  const clauses = [{ reportedByUserId: currentUser._id }];
  const staffProfileId = await getStaffProfileIdForUser(currentUser);
  if (staffProfileId) {
    clauses.push({ assignedStaffIds: staffProfileId });
  }

  return { $or: clauses };
};

const isIncidentAccessibleToUser = async (incident, currentUser) => {
  if (!currentUser || currentUser.role === 'admin') return true;
  if (String(incident.reportedByUserId || '') === String(currentUser._id)) return true;

  const staffProfileId = await getStaffProfileIdForUser(currentUser);
  if (!staffProfileId) return false;

  return (incident.assignedStaffIds || []).some((entry) => {
    const candidate = entry?._id || entry;
    return String(candidate) === String(staffProfileId);
  });
};

const validateStatus = (status) => {
  const allowed = ['open', 'investigating', 'resolved', 'closed'];
  if (!allowed.includes(status)) {
    throw new ServiceError('Invalid incident status', 400);
  }
};

const getStatusLabel = (status) => {
  const labels = {
    open: 'mở',
    investigating: 'đang điều tra',
    resolved: 'đã giải quyết',
    closed: 'đã đóng',
  };

  return labels[status] || status;
};

const buildCsvRow = (value) => {
  const text = value === undefined || value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const toCsv = (incidents) => {
  const header = [
    'incidentId',
    'residentId',
    'residentName',
    'incidentType',
    'severity',
    'status',
    'incidentAt',
    'location',
    'description',
    'reporterName',
    'reporterEmail',
    'reporterPhone',
    'reporterRole',
  ];

  const rows = incidents.map((incident) => {
    const residentIds = Array.isArray(incident.residentIds)
      ? incident.residentIds.map((resident) => resident?._id?.toString() || String(resident)).filter(Boolean)
      : incident.residentId
        ? [incident.residentId?._id?.toString() || String(incident.residentId)]
        : [];
    const residentNames = Array.isArray(incident.residentIds)
      ? incident.residentIds.map((resident) => resident?.fullName || String(resident)).filter(Boolean)
      : incident.residentId
        ? [incident.residentId?.fullName || String(incident.residentId)]
        : [];

    return [
      incident._id.toString(),
      residentIds.join('; '),
      residentNames.join('; '),
      incident.incidentType,
      incident.severity,
      incident.status,
      incident.incidentAt ? new Date(incident.incidentAt).toISOString() : '',
      incident.location || '',
      incident.description,
      incident.reporterName || '',
      incident.reporterEmail || '',
      incident.reporterPhone || '',
      incident.reporterRole || '',
    ];
  });

  const lines = [header, ...rows].map((row) => row.map(buildCsvRow).join(',')).join('\n');
  return lines;
};

const normalizeAssignedStaffIds = (assignedStaffIds) => {
  if (!assignedStaffIds) return [];
  if (Array.isArray(assignedStaffIds)) return assignedStaffIds;
  return [assignedStaffIds];
};

const convertUserIdsToStaffProfileIds = async (userIds) => {
  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) return [];

  try {
    const normalizedIds = userIds
      .map((value) => value?._id || value?.id || value)
      .filter(Boolean);

    const profiles = [];
    for (const id of normalizedIds) {
      const profile = await StaffProfile.findOne({
        $or: [{ userId: id }, { _id: id }],
      }).select('_id userId').lean();

      if (profile) profiles.push(profile);
    }

    const uniqueProfiles = profiles.filter((profile, index, arr) => arr.findIndex((item) => String(item._id) === String(profile._id)) === index);
    return uniqueProfiles.map((profile) => profile._id);
  } catch (err) {
    console.error('[ERROR] convertUserIdsToStaffProfileIds failed:', err.message);
    return [];
  }
};

const normalizeResidentIds = (residentIds) => {
  if (!residentIds) return [];
  if (Array.isArray(residentIds)) return residentIds;
  return [residentIds];
};

const parseTimeToMinutes = (value) => {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const formatClockLabel = (value) => {
  if (value instanceof Date) {
    const hours = String(value.getHours()).padStart(2, '0');
    const minutes = String(value.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  if (typeof value === 'number') {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  return String(value || '').trim();
};

const resolveStaffProfileIds = async (candidateIds = []) => {
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) return [];

  const normalizedIds = candidateIds
    .map((value) => value?._id || value?.id || value)
    .filter(Boolean);

  const profileIds = [];
  for (const id of normalizedIds) {
    if (!id) continue;
    if (mongoose.Types.ObjectId.isValid(id)) {
      const profile = await StaffProfile.findOne({ $or: [{ _id: id }, { userId: id }] }).select('_id').lean();
      if (profile) profileIds.push(String(profile._id));
    }
  }

  return [...new Set(profileIds)];
};

const getAssignmentConflictsForStaff = async ({ incidentAt, residentIds = [], staffProfileId }) => {
  const incidentDate = incidentAt instanceof Date ? incidentAt : new Date(incidentAt);
  if (Number.isNaN(incidentDate.getTime())) {
    return { staffProfileId: String(staffProfileId), canAssign: false, hasCareTask: false, hasAppointment: false, reasons: ['incidentAt không hợp lệ'] };
  }

  const dayStart = new Date(incidentDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(incidentDate);
  dayEnd.setHours(23, 59, 59, 999);

  const incidentMinutes = incidentDate.getHours() * 60 + incidentDate.getMinutes();
  const residentIdList = normalizeResidentIds(residentIds).filter(Boolean);
  const residentObjectIds = residentIdList
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  const careTasks = await CareTask.find({
    staffProfileId: new mongoose.Types.ObjectId(String(staffProfileId)),
    workDate: { $gte: dayStart, $lte: dayEnd },
    ...(residentObjectIds.length ? { residentId: { $in: residentObjectIds } } : {}),
  }).lean();

  const matchingCareTasks = careTasks.filter((task) => {
    const taskMinutes = parseTimeToMinutes(task?.scheduledTime);
    return taskMinutes !== null && Math.abs(taskMinutes - incidentMinutes) <= 30;
  });

  const hasCareTask = matchingCareTasks.length > 0;

  const appointments = await CareAppointment.find({
    $or: [
      { doctorStaffId: new mongoose.Types.ObjectId(String(staffProfileId)) },
      { nurseStaffId: new mongoose.Types.ObjectId(String(staffProfileId)) },
    ],
    scheduledStartAt: { $lte: incidentDate },
    scheduledEndAt: { $gte: incidentDate },
    ...(residentObjectIds.length ? { residentId: { $in: residentObjectIds } } : {}),
  }).lean();

  // Only keep the staff schedule for the incident day so the reassignment UI does not show historical tasks/appointments.
  const allCareTasks = await CareTask.find({
    staffProfileId: new mongoose.Types.ObjectId(String(staffProfileId)),
    workDate: { $gte: dayStart, $lte: dayEnd },
  }).lean();
  const allAppointments = await CareAppointment.find({
    $or: [
      { doctorStaffId: new mongoose.Types.ObjectId(String(staffProfileId)) },
      { nurseStaffId: new mongoose.Types.ObjectId(String(staffProfileId)) },
    ],
    scheduledStartAt: { $gte: dayStart, $lte: dayEnd },
    scheduledEndAt: { $gte: dayStart, $lte: dayEnd },
  }).lean();

  // careTasks (above) already is limited to the same day; prepare its times
  const careTasksForDayTimes = (careTasks || []).map((t) => t?.scheduledTime).filter(Boolean);

  // appointment times on the same day as incidentDate
  const appointmentTimesForDay = (allAppointments || []).filter((a) => {
    if (!a?.scheduledStartAt) return false;
    try {
      const d = new Date(a.scheduledStartAt);
      return d >= dayStart && d <= dayEnd;
    } catch (e) {
      return false;
    }
  }).map((a) => a?.scheduledStartAt).filter(Boolean);

  const hasAppointment = appointments.length > 0;
  const reasons = [];
  const careTaskTimes = matchingCareTasks.map((task) => task?.scheduledTime).filter(Boolean);
  const appointmentTimes = appointments.map((a) => a?.scheduledStartAt).filter(Boolean);
  if (hasCareTask) {
    const firstTaskTime = matchingCareTasks[0]?.scheduledTime;
    const clockLabel = formatClockLabel(parseTimeToMinutes(firstTaskTime));
    reasons.push(`có nhiệm vụ chăm sóc lúc ${clockLabel}`);
  }
  if (hasAppointment) {
    const firstAppointmentTime = formatClockLabel(appointments[0]?.scheduledStartAt);
    reasons.push(`có lịch khám lúc ${firstAppointmentTime}`);
  }

  return {
    staffProfileId: String(staffProfileId),
    canAssign: !hasCareTask && !hasAppointment,
    hasCareTask,
    hasAppointment,
    careTaskCount: matchingCareTasks.length,
    appointmentCount: appointments.length,
    careTaskTimes,
    appointmentTimes,
    allCareTaskTimes: allCareTasks.map((t) => t?.scheduledTime).filter(Boolean),
    allAppointmentTimes: allAppointments.map((a) => a?.scheduledStartAt).filter(Boolean),
    careTasksForDayTimes,
    appointmentTimesForDay,
    reasons,
  };
};

const getAssignmentConflicts = async (currentUser, payload = {}) => {
  if (!currentUser || currentUser.role !== 'admin') {
    throw new ServiceError('Only admins can check assignment conflicts', 403);
  }

  const incidentAt = payload.incidentAt ? new Date(payload.incidentAt) : null;
  if (!incidentAt || Number.isNaN(incidentAt.getTime())) {
    throw new ServiceError('incidentAt is required', 400);
  }

  const residentIds = normalizeResidentIds(payload.residentIds || payload.residentId || []);
  const staffProfileIds = await resolveStaffProfileIds(payload.staffProfileIds || payload.staffIds || []);

  const conflicts = {};
  for (const staffProfileId of staffProfileIds) {
    conflicts[String(staffProfileId)] = await getAssignmentConflictsForStaff({
      incidentAt,
      residentIds,
      staffProfileId,
    });
  }

  return { conflicts, incidentAt: incidentAt.toISOString() };
};

const getResidentsForIncident = async (residentIds) => {
  const ids = normalizeResidentIds(residentIds).map(String).filter(Boolean);
  console.log('[DEBUG] getResidentsForIncident - ids to query:', ids);
  if (!ids.length) return [];
  ids.forEach((id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ServiceError('Invalid residentId', 400);
    }
  });

  const uniqueIds = [...new Set(ids)];
  const residents = await Resident.find({ _id: { $in: uniqueIds } })
    .select('_id fullName familyPortalAccountIds')
    .lean();

  console.log('[DEBUG] getResidentsForIncident - found residents:', residents.length);
  console.log('[DEBUG] getResidentsForIncident - first resident _id type:', residents[0]?._id?.constructor?.name);

  if (residents.length !== uniqueIds.length) {
    throw new ServiceError('Resident not found', 404);
  }

  return residents;
};

const getStaffProfileByUserId = async (userId, user = null) => {
  console.log('[DEBUG] getStaffProfileByUserId - Looking for userId:', userId);
  let profile = await StaffProfile.findOne({ userId }).select('_id');
  console.log('[DEBUG] getStaffProfileByUserId - Found existing profile:', !!profile);
  
  if (!profile) {
    console.log('[DEBUG] getStaffProfileByUserId - Profile not found, attempting to auto-create...');
    console.log('[DEBUG] getStaffProfileByUserId - User object:', user ? { _id: user._id, role: user.role, email: user.email } : 'Not provided');
    
    const userObj = user || (await User.findById(userId));
    console.log('[DEBUG] getStaffProfileByUserId - User to create profile for:', { _id: userObj._id, role: userObj.role, email: userObj.email });
    
    profile = await ensureStaffProfileForUser(userObj);
    console.log('[DEBUG] getStaffProfileByUserId - Auto-create result:', !!profile ? { _id: profile._id } : 'Failed');
  }
  
  if (!profile) {
    console.error('[ERROR] Staff profile not found and cannot be created for user:', userId);
    throw new ServiceError('Staff profile not found for current user', 403);
  }
  
  console.log('[DEBUG] getStaffProfileByUserId - Returning profile:', profile._id);
  return profile;
};

const getUserIdsFromStaffProfiles = (assignedStaffIds = []) =>
  assignedStaffIds.flatMap((profile) => {
    if (!profile) return [];

    const userRef = profile.userId || profile;

    if (!userRef) return [];

    if (typeof userRef === 'string' && mongoose.Types.ObjectId.isValid(userRef)) {
      return [userRef];
    }

    if (userRef instanceof mongoose.Types.ObjectId) {
      return [userRef.toString()];
    }

    if (typeof userRef === 'object' && userRef._id) {
      return [userRef._id.toString()];
    }

    return [];
  });

const ensureUnique = (values) => Array.from(new Set(values));

const createNotificationRecords = (recipients, payload) => {
  return recipients.map((recipient) => ({
    recipientUserId: recipient._id,
    category: 'incident',
    title: payload.title,
    content: payload.content,
    targetEntityType: 'Incident',
    targetEntityId: payload.targetEntityId,
    deliveryChannels: payload.deliveryChannels(recipient),
  }));
};

const buildDeliveryChannels = (user) => {
  const channels = ['in_app'];
  if (user.email) channels.push('email');
  if (user.phone) channels.push('sms');
  return channels;
};

const sendNotifications = async (incident, recipients, options = {}) => {
  if (!recipients.length) return;

  const notificationDocs = createNotificationRecords(recipients, {
    title: options.title,
    content: options.content,
    targetEntityId: incident._id,
    deliveryChannels: buildDeliveryChannels,
  });

  await notificationService.createMany(notificationDocs);

  const emailRecipients = recipients.filter((recipient) => Boolean(recipient.email));
  const smsRecipients = recipients.filter((recipient) => Boolean(recipient.phone));

  await Promise.all([
    ...emailRecipients.map((recipient) =>
      mailService.sendIncidentNotificationEmail({
        to: recipient.email,
        incident,
        recipientName: recipient.fullName,
        subject: options.emailSubject,
        message: options.content,
        assignedStaffNames: options.assignedStaffNames,
        residentName: options.residentName,
      }).catch((err) => console.error('Failed to send incident email', err.message))
    ),
    ...smsRecipients.map((recipient) =>
      mailService
        .sendTextBeeSms({
          to: recipient.phone,
          message: options.smsMessage,
        })
        .catch((err) => console.error('Failed to send incident sms', err.message))
    ),
  ]);
};

const notifyIncident = async (incident, options) => {
  // Extract resident IDs - handle both ObjectId and populated Resident objects
  const extractResidentId = (item) => {
    if (!item) return null;
    // If it's a populated Resident object with _id property
    if (item._id) return item._id.toString?.() || String(item._id);
    // Otherwise treat it as an ObjectId
    return String(item);
  };

  const residentIds = [...new Set([
    ...(Array.isArray(incident.residentIds) ? incident.residentIds.map(extractResidentId).filter(Boolean) : []),
    ...(incident.residentId ? [extractResidentId(incident.residentId)] : []),
  ])];

  console.log('[DEBUG] notifyIncident - extracted residentIds:', residentIds);

  const residentDocs = residentIds.length
    ? await Resident.find({ _id: { $in: residentIds } }).select('familyPortalAccountIds').lean()
    : [];

  const familyUserIds = residentDocs.flatMap((resident) => resident.familyPortalAccountIds || []).map(String);
  const familyUsers = familyUserIds.length
    ? await User.find({ _id: { $in: [...new Set(familyUserIds)] }, isActive: true, isBanned: false })
        .select('fullName email phone role')
        .lean()
    : [];

  const assignedUserIds = getUserIdsFromStaffProfiles(incident.assignedStaffIds || []);
  const assignedUsers = assignedUserIds.length
    ? await User.find({ _id: { $in: assignedUserIds }, isActive: true, isBanned: false })
        .select('fullName email phone role')
        .lean()
    : [];

  const recipients = ensureUnique([
    ...assignedUsers,
    ...familyUsers,
  ].map((user) => user._id.toString()));

  const recipientDocs = await User.find({ _id: { $in: recipients }, isActive: true, isBanned: false })
    .select('fullName email phone role')
    .lean();

  await sendNotifications(incident, recipientDocs, options);

  if (familyUsers.length) {
    await incidentRepo.updateById(incident._id, {
      notifiedFamilyIds: ensureUnique([
        ...(incident.notifiedFamilyIds || []).map((id) => id.toString()),
        ...familyUsers.map((user) => user._id.toString()),
      ]),
    });
  }
};

const MAX_TEXT_LENGTH = 500;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000; // allow small clock-skew, but block clearly future-dated incidents

const assertMaxLength = (value, fieldName, max = MAX_TEXT_LENGTH) => {
  if (value && value.length > max) {
    throw new ServiceError(`${fieldName} must be at most ${max} characters`, 400);
  }
};

const createIncident = async (currentUser, payload) => {
  console.log('[DEBUG] === START createIncident ===');
  console.log('[DEBUG] currentUser:', { _id: currentUser._id, role: currentUser.role, email: currentUser.email });
  console.log('[DEBUG] payload:', { incidentType: payload?.incidentType, description: payload?.description?.substring(0, 50), residentIds: payload?.residentIds, residentId: payload?.residentId });
  
  if (!payload?.incidentType?.trim()) throw new ServiceError('incidentType is required', 400);
  if (!payload?.description?.trim()) throw new ServiceError('description is required', 400);
  if (!payload?.incidentAt) throw new ServiceError('incidentAt is required', 400);

  const incidentAtDate = new Date(payload.incidentAt);
  if (Number.isNaN(incidentAtDate.getTime())) {
    throw new ServiceError('incidentAt is invalid', 400);
  }
  if (incidentAtDate.getTime() > Date.now() + MAX_FUTURE_SKEW_MS) {
    throw new ServiceError('incidentAt cannot be in the future', 400);
  }

  assertMaxLength(payload.incidentType.trim(), 'incidentType', 200);
  assertMaxLength(payload.description.trim(), 'description');
  assertMaxLength(payload.location?.trim(), 'location', 200);

  try {
    const residentIds = normalizeResidentIds(payload.residentIds?.length ? payload.residentIds : payload.residentId || []);
    console.log('[DEBUG] normalizeResidentIds result:', residentIds);

    const residents = await getResidentsForIncident(residentIds);
    console.log('[DEBUG] residents found:', residents.length);

    // Try to get staff profile, but don't fail if not found (admin users won't have one)
    let staffProfile = null;
    try {
      staffProfile = await getStaffProfileByUserId(currentUser._id, currentUser);
      console.log('[DEBUG] staffProfile obtained:', staffProfile._id);
    } catch (err) {
      console.log('[DEBUG] Staff profile not available (role may not be assignable):', err.message);
      console.log('[DEBUG] Continuing with reportedByStaffId = null');
    }

    const shouldAssignHandlers = String(currentUser.role || '').toLowerCase() === 'admin';
    const assignedStaffIds = shouldAssignHandlers ? normalizeAssignedStaffIds(payload.assignedStaffIds) : [];
    console.log('[DEBUG] assignedStaffIds from payload (User IDs):', assignedStaffIds);

    // Convert User IDs to StaffProfile IDs
    const assignedStaffProfileIds = shouldAssignHandlers
      ? await convertUserIdsToStaffProfileIds(assignedStaffIds)
      : [];
    console.log('[DEBUG] assignedStaffProfileIds (converted):', assignedStaffProfileIds);

    if (assignedStaffProfileIds.length) {
      const conflictPayload = await getAssignmentConflicts(currentUser, {
        incidentAt: payload.incidentAt,
        residentIds: residentIds,
        staffProfileIds: assignedStaffProfileIds,
      });
      const blockedStaffs = Object.values(conflictPayload.conflicts || {}).filter((conflict) => !conflict.canAssign);
      if (blockedStaffs.length) {
        const formatted = blockedStaffs.map((conflict) => conflict.reasons.join(' và ')).join('; ');
        throw new ServiceError(`Không thể chỉ định nhân viên vì ${formatted}.`, 400);
      }
    }

    const reporter = getReporterDetails(currentUser, payload);
    console.log('[DEBUG] reporter details:', reporter);
    
    console.log('[DEBUG] residents count:', residents.length);
    
    // Ensure residentIds are proper ObjectIds (not strings or stringified objects)
    const residentIdArray = residents.length 
      ? residents.map((resident) => {
          const id = resident._id;
          if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new ServiceError(`Invalid resident ObjectId: ${id}`, 400);
          }
          return new mongoose.Types.ObjectId(String(id));
        })
      : [];
    
    console.log('[DEBUG] residentIdArray prepared:', residentIdArray.length, 'first:', residentIdArray[0]?.toString().substring(0, 12));
    
    const incidentData = {
    residentId: residents[0]?._id || null,
    residentIds: residentIdArray.length ? residentIdArray : undefined,
    reportedByStaffId: staffProfile?._id || null,
    reportedByUserId: currentUser._id,
    incidentType: payload.incidentType.trim(),
    severity: payload.severity || 'medium',
    incidentAt: incidentAtDate,
    location: payload.location?.trim() || '',
    description: payload.description.trim(),
    status: 'open',
    assignedStaffIds: assignedStaffProfileIds,
    reporterName: reporter.reporterName,
    reporterEmail: reporter.reporterEmail,
    reporterPhone: reporter.reporterPhone,
    reporterRole: reporter.reporterRole,
  };
  
  console.log('[DEBUG] incidentData built - residentIds count:', incidentData.residentIds?.length || 0);

  const incident = await incidentRepo.createIncident(incidentData);
  console.log('[DEBUG] Incident created with ID:', incident._id);
  
  let createdIncident;
  try {
    createdIncident = await incidentRepo.findById(incident._id);
    console.log('[DEBUG] Incident populated successfully');
  } catch (populateErr) {
    console.error('[WARN] Incident populate failed (but incident was created):', populateErr.message);
    createdIncident = incident;
  }

  const firstResidentName = residents[0]?.fullName || 'bệnh nhân';
    
    // Get all resident names
    const allResidentNames = residents
      .map((resident) => resident.fullName || 'bệnh nhân')
      .join(', ');

    // Extract assigned staff names
    const assignedStaffNames = createdIncident.assignedStaffIds
      ?.map((staff) => staff.userId?.fullName || staff.userId?.email || 'Nhân viên')
      .filter(Boolean)
      .join(', ') || 'Chưa gán nhân viên';

    await notifyIncident(createdIncident, {
      title: 'Báo cáo sự cố mới',
      residentName: allResidentNames,
      assignedStaffNames,
      content: `Sự cố ${createdIncident.incidentType} đã được ghi nhận cho bệnh nhân: ${allResidentNames}.`,
      emailSubject: `Báo cáo sự cố mới: ${createdIncident.incidentType}`,
      smsMessage: `Báo cáo sự cố mới: ${createdIncident.incidentType} cho bệnh nhân ${allResidentNames}. Nhân viên xử lý: ${assignedStaffNames}. Vui lòng kiểm tra hệ thống.`,
    });

    console.log('[DEBUG] === END createIncident - SUCCESS ===');
    return createdIncident;
  } catch (error) {
    console.error('[ERROR] createIncident failed:', error.message);
    console.error('[ERROR] Full error:', error);
    throw error;
  }
};

const listIncidents = async (currentUser, query) => {
  const filter = await getIncidentFilter(query, currentUser);
  const { page, limit, skip } = parsePagination(query);
  const sort = getSort(query);

  const [items, total] = await Promise.all([
    incidentRepo.findAll(filter, { sort, skip, limit }),
    incidentRepo.countAll(filter),
  ]);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

const getIncident = async (currentUser, id) => {
  const incident = await incidentRepo.findById(id);
  if (!incident) throw new ServiceError('Incident not found', 404);

  const canView = await isIncidentAccessibleToUser(incident, currentUser);
  if (!canView) throw new ServiceError('Incident not found', 404);

  return incident;
};

const updateIncidentStatus = async (currentUser, id, payload) => {
  validateStatus(payload.status);

  const existing = await incidentRepo.findById(id);
  if (!existing) throw new ServiceError('Incident not found', 404);

  // Prevent backward status transitions. Allowed statuses in order:
  const STATUS_ORDER = ['open', 'investigating', 'resolved', 'closed'];
  const currentIndex = STATUS_ORDER.indexOf(existing.status);
  const newIndex = STATUS_ORDER.indexOf(payload.status);
  if (newIndex < currentIndex) {
    throw new ServiceError('Invalid status transition: cannot move to a previous state', 400);
  }

  // Prevent direct transition to 'resolved' unless there is a valid resolution
  if (payload.status === 'resolved') {
    // Only allow resolving from investigating
    if (existing.status !== 'investigating') {
      throw new ServiceError('Không thể chuyển sang "đã giải quyết" trừ khi sự cố đang ở trạng thái "đang xác minh".', 400);
    }
    const res = existing.resolution || {};
    if (!res.method || !res.rootCause || !res.result) {
      throw new ServiceError('Không thể chuyển sang "đã giải quyết": thông tin giải quyết chưa đầy đủ.', 400);
    }
  }

  const updated = await incidentRepo.updateById(id, { status: payload.status });

  await notifyIncident(updated, {
    title: 'Cập nhật trạng thái sự cố',
    content: `Trạng thái sự cố ${updated.incidentType} đã được cập nhật thành ${getStatusLabel(updated.status)}.`,
    emailSubject: `Cập nhật trạng thái sự cố: ${updated.incidentType}`,
    smsMessage: `Trạng thái sự cố ${updated.incidentType} đã được cập nhật thành ${getStatusLabel(updated.status)}.`,
  });

  return updated;
};

const exportIncidents = async (currentUser, query) => {
  const filter = await getIncidentFilter(query, currentUser);
  const incidents = await incidentRepo.findAll(filter, { sort: getSort(query) });
  return {
    csv: toCsv(incidents),
    fileName: `incidents-${Date.now()}.csv`,
  };
};

const assignHandlers = async (currentUser, id, payload) => {
  // Only admin can assign handlers
  if (!currentUser || currentUser.role !== 'admin') {
    throw new ServiceError('Only admins can assign handlers', 403);
  }

  const existing = await incidentRepo.findById(id);
  if (!existing) throw new ServiceError('Incident not found', 404);

  // Check if handlers are already assigned
  if (existing.assignedStaffIds && existing.assignedStaffIds.length > 0) {
    throw new ServiceError('Handlers already assigned to this incident', 400);
  }

  const assignedStaffIds = normalizeAssignedStaffIds(payload.assignedStaffIds);
  if (!assignedStaffIds || assignedStaffIds.length === 0) {
    throw new ServiceError('At least one handler must be specified', 400);
  }

  // Convert user IDs to staff profile IDs if needed
  const staffProfileIds = await convertUserIdsToStaffProfileIds(assignedStaffIds);

  const existingIncident = await incidentRepo.findById(id);
  const incidentAt = existingIncident?.incidentAt || null;
  const residentIds = existingIncident?.residentIds || (existingIncident?.residentId ? [existingIncident.residentId] : []);
  if (staffProfileIds.length && incidentAt) {
    const conflictPayload = await getAssignmentConflicts(currentUser, {
      incidentAt,
      residentIds,
      staffProfileIds,
    });
    const blockedStaffs = Object.values(conflictPayload.conflicts || {}).filter((conflict) => !conflict.canAssign);
    if (blockedStaffs.length) {
      const formatted = blockedStaffs.map((conflict) => conflict.reasons.join(' và ')).join('; ');
      throw new ServiceError(`Không thể chỉ định nhân viên vì ${formatted}.`, 400);
    }
  }

  const updated = await incidentRepo.updateById(id, { assignedStaffIds: staffProfileIds });

  await notifyIncident(updated, {
    title: 'Được chỉ định xử lý sự cố',
    content: `Bạn đã được chỉ định để xử lý sự cố ${updated.incidentType}.`,
    emailSubject: `Được chỉ định xử lý sự cố: ${updated.incidentType}`,
    smsMessage: `Bạn đã được chỉ định để xử lý sự cố ${updated.incidentType}.`,
  });

  return updated;
};

const updateIncidentResolution = async (currentUser, id, payload = {}, files = []) => {
  const existing = await incidentRepo.findById(id);
  if (!existing) throw new ServiceError('Incident not found', 404);

  const canEdit = await isIncidentAccessibleToUser(existing, currentUser);
  if (!canEdit) throw new ServiceError('Incident not found', 404);

  // Only allow entering resolution when incident is in 'investigating' state
  if (existing.status !== 'investigating') {
    throw new ServiceError('Chỉ được nhập thông tin giải quyết khi sự cố đang ở trạng thái "đang xác minh".', 400);
  }

  // Build resolution object
  const resolution = {
    method: payload.method || existing.resolution?.method || '',
    rootCause: payload.rootCause || existing.resolution?.rootCause || '',
    detailedCause: payload.detailedCause || existing.resolution?.detailedCause || '',
    immediateActions: [],
    medical: existing.resolution?.medical || { medications: [], procedures: [], residentCondition: '', needFollowUp: false },
    severityAssessment: payload.severityAssessment || existing.resolution?.severityAssessment || '',
    escalationRequested: payload.escalationRequested || existing.resolution?.escalationRequested || false,
    notes: payload.notes || existing.resolution?.notes || '',
  };

  // immediateActions may come as comma-separated string or array
  if (payload.immediateActions) {
    if (Array.isArray(payload.immediateActions)) resolution.immediateActions = payload.immediateActions;
    else resolution.immediateActions = String(payload.immediateActions).split(',').map((s) => s.trim()).filter(Boolean);
  }

  // medical medications may be JSON encoded
  if (payload.medications) {
    try {
      resolution.medical.medications = Array.isArray(payload.medications) ? payload.medications : JSON.parse(payload.medications);
    } catch {
      resolution.medical.medications = [];
    }
  }
  if (payload.procedures) {
    try {
      resolution.medical.procedures = Array.isArray(payload.procedures) ? payload.procedures : JSON.parse(payload.procedures);
    } catch {
      resolution.medical.procedures = [];
    }
  }
  if (payload.residentCondition) resolution.medical.residentCondition = payload.residentCondition;
  if (payload.needFollowUp !== undefined) resolution.medical.needFollowUp = payload.needFollowUp === 'true' || payload.needFollowUp === true;

  // If action === markResolved, set completedAt and resolvedByUserId and update status
  const action = payload.action || '';
  if (action === 'markResolved') {
    // Validate required resolution fields before marking resolved
    if (!resolution.method || !resolution.rootCause || !resolution.severityAssessment) {
      throw new ServiceError('Không thể đánh dấu là đã giải quyết: thiếu thông tin bắt buộc (Phương pháp, Nguyên nhân chính, Đánh giá mức độ).', 400);
    }
    resolution.completedAt = new Date();
    resolution.resolvedByUserId = currentUser._id;
  }

  // Upload attachments before saving the resolution so failed uploads do not look successful.
  const { uploadImageBuffer, uploadRawBuffer } = require('../utils/cloudinaryUpload');
  const attachments = [];
  for (const file of files) {
    if (!file?.buffer?.length) throw new ServiceError('File đính kèm không hợp lệ.', 400);
    const isImage = String(file.mimetype || '').startsWith('image/');
    const result = isImage
      ? await uploadImageBuffer(file.buffer, { folder: 'nursing-home/incidents/resolution', mimeType: file.mimetype })
      : await uploadRawBuffer(file.buffer, { folder: 'nursing-home/incidents/resolution', mimeType: file.mimetype });
    attachments.push({
      fileName: file.originalname,
      fileUrl: result.secure_url,
      cloudinaryPublicId: result.public_id,
      mimeType: file.mimetype,
      sizeInBytes: file.size,
      uploadedAt: new Date(),
    });
  }

  // Merge with existing attachments
  resolution.attachments = [...(existing.resolution?.attachments || []), ...attachments];

  // If marking resolved, also set incident status to resolved
  const update = { resolution };
  if (action === 'markResolved') update.status = 'resolved';

  const updated = await incidentRepo.updateById(id, update);

  // Notify assigned staff and family if resolved
  if (action === 'markResolved') {
    await notifyIncident(updated, {
      title: 'Sự cố đã được giải quyết',
      content: `Sự cố ${updated.incidentType} đã được đánh dấu là đã giải quyết.`,
      emailSubject: `Sự cố đã giải quyết: ${updated.incidentType}`,
      smsMessage: `Sự cố ${updated.incidentType} đã được giải quyết.`,
    });
  }

  return updated;
};

const reopenIncident = async (currentUser, id, payload) => {
  const existing = await incidentRepo.findById(id);
  if (!existing) throw new ServiceError('Incident not found', 404);

  // Only allow reopening resolved incidents that have escalation requested
  if (existing.status !== 'resolved') {
    throw new ServiceError('Sự cố phải ở trạng thái đã giải quyết mới có thể mở lại', 400);
  }

  if (!existing.resolution?.escalationRequested) {
    throw new ServiceError('Chỉ có thể mở lại sự cố có yêu cầu chuyển cấp', 400);
  }

  // Update assigned staff if provided
  const updateData = { status: 'investigating' };
  if (payload.assignedStaffIds && Array.isArray(payload.assignedStaffIds) && payload.assignedStaffIds.length > 0) {
    updateData.assignedStaffIds = payload.assignedStaffIds;
  }

  const updated = await incidentRepo.updateById(id, updateData);

  await notifyIncident(updated, {
    title: 'Sự cố được mở lại',
    content: `Sự cố ${updated.incidentType} đã được mở lại để xử lý tiếp.`,
    emailSubject: `Sự cố được mở lại: ${updated.incidentType}`,
  });

  return updated;
};

module.exports = {
  createIncident,
  listIncidents,
  getIncident,
  updateIncidentStatus,
  assignHandlers,
  updateIncidentResolution,
  exportIncidents,
  getAssignmentConflicts,
  reopenIncident,
};

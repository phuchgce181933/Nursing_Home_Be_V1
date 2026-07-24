const mongoose = require('mongoose');
const Resident = require('../models/resident');
const StaffProfile = require('../models/staffProfile');
const User = require('../models/user');
const incidentRepo = require('../repositories/incidentRepository');
const notificationService = require('./notificationService');
const mailService = require('./mailService');
const ServiceError = require('./serviceError');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

const parsePagination = (query) => {
  const page = Math.max(1, Number.parseInt(query.page || DEFAULT_PAGE, 10));
  const limit = Math.max(1, Number.parseInt(query.limit || DEFAULT_LIMIT, 10));

  return { page, limit, skip: (page - 1) * limit };
};

const getIncidentFilter = (query) => {
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
  if (query.residentId) filter.residentId = query.residentId;
  if (query.reporterRole) filter.reporterRole = query.reporterRole;

  if (query.incidentFrom || query.incidentTo) {
    filter.incidentAt = {};
    if (query.incidentFrom) filter.incidentAt.$gte = new Date(query.incidentFrom);
    if (query.incidentTo) filter.incidentAt.$lte = new Date(`${query.incidentTo}T23:59:59.999Z`);
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

const validateStatus = (status) => {
  const allowed = ['open', 'investigating', 'resolved', 'closed'];
  if (!allowed.includes(status)) {
    throw new ServiceError('Invalid incident status', 400);
  }
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

  const rows = incidents.map((incident) => [
    incident._id.toString(),
    incident.residentId?._id?.toString() || '',
    incident.residentId?.fullName || '',
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
  ]);

  const lines = [header, ...rows].map((row) => row.map(buildCsvRow).join(',')).join('\n');
  return lines;
};

const normalizeAssignedStaffIds = (assignedStaffIds) => {
  if (!assignedStaffIds) return [];
  if (Array.isArray(assignedStaffIds)) return assignedStaffIds;
  return [assignedStaffIds];
};

const getResidentForIncident = async (residentId) => {
  if (!residentId) return null;
  if (!mongoose.Types.ObjectId.isValid(residentId)) {
    throw new ServiceError('Invalid residentId', 400);
  }

  const resident = await Resident.findById(residentId).select('_id fullName familyPortalAccountIds');
  if (!resident) {
    throw new ServiceError('Resident not found', 404);
  }
  return resident;
};

const getStaffProfileByUserId = async (userId) => {
  const profile = await StaffProfile.findOne({ userId }).select('_id');
  if (!profile) {
    throw new ServiceError('Staff profile not found for current user', 403);
  }
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
      }).catch((err) => console.error('Failed to send incident email', err.message))
    ),
    ...smsRecipients.map((recipient) =>
      mailService
        .sendTextBeeSms({
          to: recipient.phone,
          message: options.smsMessage.replace('{recipientName}', recipient.fullName || 'there'),
        })
        .catch((err) => console.error('Failed to send incident sms', err.message))
    ),
  ]);
};

const notifyIncident = async (incident, options) => {
  const resident = await Resident.findById(incident.residentId).select('familyPortalAccountIds').lean();
  const familyUserIds = resident?.familyPortalAccountIds?.map((id) => id.toString()) || [];
  const familyUsers = familyUserIds.length
    ? await User.find({ _id: { $in: familyUserIds }, isActive: true, isBanned: false })
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

  const resident = await getResidentForIncident(payload.residentId);
  const staffProfile = await getStaffProfileByUserId(currentUser._id);
  const assignedStaffIds = normalizeAssignedStaffIds(payload.assignedStaffIds);

  const reporter = getReporterDetails(currentUser, payload);
  const incidentData = {
    residentId: resident?._id || null,
    reportedByStaffId: staffProfile._id,
    reportedByUserId: currentUser._id,
    incidentType: payload.incidentType.trim(),
    severity: payload.severity || 'medium',
    incidentAt: incidentAtDate,
    location: payload.location?.trim() || '',
    description: payload.description.trim(),
    status: 'open',
    assignedStaffIds,
    reporterName: reporter.reporterName,
    reporterEmail: reporter.reporterEmail,
    reporterPhone: reporter.reporterPhone,
    reporterRole: reporter.reporterRole,
  };

  const incident = await incidentRepo.createIncident(incidentData);
  const createdIncident = await incidentRepo.findById(incident._id);

  await notifyIncident(createdIncident, {
    title: 'Incident báo cáo mới',
    content: `Sự cố ${createdIncident.incidentType} đã được ghi nhận cho ${resident?.fullName || 'bệnh nhân'}.`,
    emailSubject: `Incident mới: ${createdIncident.incidentType}`,
    smsMessage: `Sự cố ${createdIncident.incidentType} đã được ghi nhận. Vui lòng kiểm tra hệ thống.`,
  });

  return createdIncident;
};

const listIncidents = async (query) => {
  const filter = getIncidentFilter(query);
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

const getIncident = async (id) => {
  const incident = await incidentRepo.findById(id);
  if (!incident) throw new ServiceError('Incident not found', 404);
  return incident;
};

const updateIncidentStatus = async (currentUser, id, payload) => {
  validateStatus(payload.status);

  const existing = await incidentRepo.findById(id);
  if (!existing) throw new ServiceError('Incident not found', 404);

  const updated = await incidentRepo.updateById(id, { status: payload.status });

  await notifyIncident(updated, {
    title: 'Cập nhật trạng thái incident',
    content: `Trạng thái incident ${updated.incidentType} đã được cập nhật thành ${updated.status}.`,
    emailSubject: `Cập nhật incident: ${updated.incidentType}`,
    smsMessage: `Trạng thái incident ${updated.incidentType} đã cập nhật thành ${updated.status}.`,
  });

  return updated;
};

const exportIncidents = async (query) => {
  const filter = getIncidentFilter(query);
  const incidents = await incidentRepo.findAll(filter, { sort: getSort(query) });
  return {
    csv: toCsv(incidents),
    fileName: `incidents-${Date.now()}.csv`,
  };
};

module.exports = {
  createIncident,
  listIncidents,
  getIncident,
  updateIncidentStatus,
  exportIncidents,
};

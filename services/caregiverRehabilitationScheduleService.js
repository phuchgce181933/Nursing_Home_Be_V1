const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const assignedResidentService = require('./assignedResidentService');
const staffProfileRepo = require('../repositories/staffProfileRepository');
const rehabDayRepo = require('../repositories/rehabilitationScheduleDayRepository');
const rehabEntryRepo = require('../repositories/rehabilitationScheduleEntryRepository');
const { parseWorkDate } = require('../utils/shiftTime');

const parseWorkDateStrict = (workDate) => {
  const str = String(workDate || '').trim();
  try {
    parseWorkDate(str);
  } catch {
    throw new ServiceError('workDate phải đúng định dạng YYYY-MM-DD', 400);
  }
  return str;
};

const assertValidObjectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
    throw new ServiceError(`${label} không hợp lệ`, 400);
  }
};

const getCaregiverProfile = async (userId) => {
  const profile = await staffProfileRepo.findByUserId(userId);
  if (!profile) {
    throw new ServiceError('Không tìm thấy hồ sơ nhân viên. Vui lòng liên hệ quản trị.', 400);
  }
  return profile;
};

const assertResidentAssigned = async (profile, residentId) => {
  const assigned = (profile.assignedResidentIds || []).map((r) => String(r._id || r));
  if (!assigned.includes(String(residentId))) {
    throw new ServiceError('Cư dân không thuộc danh sách phụ trách của bạn', 403);
  }
};

const mapSession = (entry) => ({
  sessionType: entry.sessionType,
  scheduledTime: entry.scheduledTime,
  durationMinutes: entry.durationMinutes,
  location: entry.location,
  sessionTitle: entry.sessionTitle,
  therapyGoals: entry.therapyGoals,
  caregiverAssistNote: entry.caregiverAssistNote,
  leadStaffName: entry.leadStaffName,
});

const sortSessions = (sessions) =>
  [...sessions].sort((a, b) => String(a.scheduledTime).localeCompare(String(b.scheduledTime)));

const listAssignedResidents = async (userId) =>
  assignedResidentService.listAssignedResidentsForUser(userId, { fields: 'minimal' });

const listOverview = async (userId, query) => {
  if (!query.workDate) {
    throw new ServiceError('workDate là bắt buộc (YYYY-MM-DD)', 400);
  }
  const workDate = parseWorkDateStrict(query.workDate);
  const profile = await getCaregiverProfile(userId);
  const { data: residentList } = await assignedResidentService.listAssignedResidentsForUser(userId, {
    search: query.search,
  });
  let rows = residentList || [];

  if (query.residentId) {
    assertValidObjectId(query.residentId, 'residentId');
    await assertResidentAssigned(profile, query.residentId);
    rows = rows.filter((r) => String(r._id) === String(query.residentId));
  }

  const residentIds = rows.map((r) => r._id);
  const publishedDay = await rehabDayRepo.findPublishedByWorkDate(workDate);

  const sessionCountsByResident = new Map();
  if (publishedDay && residentIds.length) {
    const entries = await rehabEntryRepo.findByDayIdAndResidents(publishedDay._id, residentIds);
    for (const entry of entries) {
      const rid = String(entry.residentId);
      sessionCountsByResident.set(rid, (sessionCountsByResident.get(rid) || 0) + 1);
    }
  }

  const data = rows.map((r) => {
    const rid = String(r._id);
    const sessionCount = sessionCountsByResident.get(rid) || 0;
    return {
      residentId: rid,
      fullName: r.fullName,
      residentCode: r.residentCode,
      hasRehabSchedule: sessionCount > 0,
      sessionCount,
    };
  });

  return {
    workDate,
    hasPublishedRehabDay: Boolean(publishedDay),
    planTitle: publishedDay?.title || null,
    data,
    total: data.length,
  };
};

const getResidentSchedule = async (userId, residentId, query) => {
  assertValidObjectId(residentId, 'residentId');
  if (!query.workDate) {
    throw new ServiceError('workDate là bắt buộc (YYYY-MM-DD)', 400);
  }
  const workDate = parseWorkDateStrict(query.workDate);
  const profile = await getCaregiverProfile(userId);
  await assertResidentAssigned(profile, residentId);

  const resident = await assignedResidentService.getAssignedResidentById(userId, residentId);
  const publishedDay = await rehabDayRepo.findPublishedByWorkDate(workDate);

  let sessions = [];
  if (publishedDay) {
    const entries = await rehabEntryRepo.findByDayIdAndResidents(publishedDay._id, [residentId]);
    sessions = sortSessions(entries.map(mapSession));
  }

  return {
    workDate,
    resident: {
      residentId: String(resident._id),
      fullName: resident.fullName,
      residentCode: resident.residentCode,
      allergies: resident.allergies || [],
      drugAllergies: resident.drugAllergies || [],
      chronicConditions: resident.chronicConditions || [],
    },
    schedule: {
      published: sessions.length > 0,
      planTitle: publishedDay?.title || null,
      publishedAt: publishedDay?.publishedAt || null,
      sessions,
    },
  };
};

module.exports = {
  listAssignedResidents,
  listOverview,
  getResidentSchedule,
};

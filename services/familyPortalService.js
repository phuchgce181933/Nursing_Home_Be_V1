const mongoose = require('mongoose');
const ServiceError = require('./serviceError');
const familyPortalRepo = require('../repositories/familyPortalRepository');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const parsePagination = (query) => {
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
};

const assertValidObjectId = (id, label = 'id') => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ServiceError(`${label} không hợp lệ`, 400);
  }
};

// Throws 403 if family user does not have access to the given resident.
const assertResidentAccess = async (userId, residentId) => {
  assertValidObjectId(residentId, 'residentId');
  const ids = await familyPortalRepo.getFamilyResidentIds(userId);
  if (!ids.includes(residentId.toString())) {
    throw new ServiceError('Bạn không có quyền xem thông tin cư dân này', 403);
  }
};

// ─── Residents ────────────────────────────────────────────────────────────────

/**
 * Trả về danh sách cư dân được liên kết với tài khoản gia đình.
 * (Remote Monitoring — danh sách người thân)
 */
const getResidents = async (user) => familyPortalRepo.getResidentsForFamily(user._id);

/**
 * Xem thông tin cá nhân cơ bản của cư dân.
 * UC: View Basic Profile Information
 */
const getResident = async (user, residentId) => {
  await assertResidentAccess(user._id, residentId);
  const resident = await familyPortalRepo.getResidentById(residentId);
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);
  return resident;
};

// ─── Health Indicators ───────────────────────────────────────────────────────

/**
 * Trả về bản ghi đo lường sức khỏe mới nhất.
 * UC: View Current Health Indicators
 */
const getVitals = async (user, residentId) => {
  await assertResidentAccess(user._id, residentId);
  const records = await familyPortalRepo.findMedicalRecords(
    { residentId },
    { sort: { measuredAt: -1 }, limit: 1 },
  );
  return records.length ? records[0] : null;
};

/**
 * Lịch sử chỉ số sức khỏe theo trang, hỗ trợ tìm kiếm + lọc ngày + lọc bất thường.
 * UC: View Health Indicator History / Search for Health Information / Filter Health Data
 */
const getHealthHistory = async (user, residentId, query) => {
  await assertResidentAccess(user._id, residentId);

  const filter = { residentId };
  if (query.from || query.to) {
    filter.measuredAt = {};
    if (query.from) filter.measuredAt.$gte = new Date(query.from);
    if (query.to) filter.measuredAt.$lte = new Date(query.to);
  }
  if (query.search) filter.summary = { $regex: query.search.trim(), $options: 'i' };
  if (query.abnormalOnly === 'true') filter.abnormalFlag = true;

  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    familyPortalRepo.findMedicalRecords(filter, { sort: { measuredAt: -1 }, skip, limit: limitNum }),
    familyPortalRepo.countMedicalRecords(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

const VALID_METRICS = [
  'bloodPressureSystolic', 'bloodPressureDiastolic', 'pulse',
  'temperatureCelsius', 'oxygenSaturation', 'bloodSugar', 'weightKg',
];

/**
 * Dữ liệu chuỗi thời gian cho biểu đồ sức khỏe, mặc định 30 ngày gần nhất.
 * UC: View Health Charts
 */
const getHealthChart = async (user, residentId, query) => {
  await assertResidentAccess(user._id, residentId);

  if (query.metric && !VALID_METRICS.includes(query.metric)) {
    throw new ServiceError(`metric phải là một trong: ${VALID_METRICS.join(', ')}`, 400);
  }

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(now.getDate() - 30);

  const filter = {
    residentId,
    measuredAt: {
      $gte: query.from ? new Date(query.from) : defaultFrom,
      $lte: query.to ? new Date(query.to) : now,
    },
  };

  // limit: 0 = không giới hạn (dữ liệu cho chart cần tất cả điểm trong khoảng thời gian)
  const records = await familyPortalRepo.findMedicalRecords(filter, { sort: { measuredAt: 1 }, limit: 0 });
  return records.map((record) => {
    const doc = record.toObject ? record.toObject() : record;
    const selected = { measuredAt: doc.measuredAt, abnormalFlag: doc.abnormalFlag };
    if (query.metric) {
      selected[query.metric] = doc[query.metric] ?? null;
    } else {
      VALID_METRICS.forEach((m) => { selected[m] = doc[m] ?? null; });
    }
    return selected;
  });
};

// ─── Care Logs ────────────────────────────────────────────────────────────────

const VALID_NOTE_TYPES = ['meal', 'activity', 'health', 'general'];

/**
 * Nhật ký chăm sóc phân trang, lọc theo loại, tìm kiếm nội dung.
 * UC: View Care Logs / Search / Filter Health Data
 */
const getCareNotes = async (user, residentId, query) => {
  await assertResidentAccess(user._id, residentId);

  const filter = { residentId };
  if (query.noteType) {
    if (!VALID_NOTE_TYPES.includes(query.noteType)) {
      throw new ServiceError(`noteType phải là một trong: ${VALID_NOTE_TYPES.join(', ')}`, 400);
    }
    filter.noteType = query.noteType;
  }
  if (query.search) filter.content = { $regex: query.search.trim(), $options: 'i' };
  if (query.from || query.to) {
    filter.noteAt = {};
    if (query.from) filter.noteAt.$gte = new Date(query.from);
    if (query.to) filter.noteAt.$lte = new Date(query.to);
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    familyPortalRepo.findCareNotes(filter, { sort: { noteAt: -1 }, skip, limit: limitNum }),
    familyPortalRepo.countCareNotes(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

// ─── Medication History ───────────────────────────────────────────────────────

const VALID_MED_STATUSES = ['PENDING', 'TAKEN', 'LATE_TAKEN', 'MISSED', 'SKIPPED', 'OVERDUE'];

/**
 * Lịch sử dùng thuốc (MedicationSchedule), lọc theo tên thuốc, trạng thái, ngày.
 * UC: View Medication History / Filter Health Data
 */
const getMedications = async (user, residentId, query) => {
  await assertResidentAccess(user._id, residentId);

  const filter = { residentId };
  if (query.status) {
    if (!VALID_MED_STATUSES.includes(query.status.toUpperCase())) {
      throw new ServiceError(`status phải là một trong: ${VALID_MED_STATUSES.join(', ')}`, 400);
    }
    filter.status = query.status.toUpperCase();
  }
  if (query.medicationName) {
    filter.medicationName = { $regex: query.medicationName.trim(), $options: 'i' };
  }
  if (query.from || query.to) {
    filter.scheduledTime = {};
    if (query.from) filter.scheduledTime.$gte = new Date(query.from);
    if (query.to) filter.scheduledTime.$lte = new Date(query.to);
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    familyPortalRepo.findMedicationSchedules(filter, { sort: { scheduledTime: -1 }, skip, limit: limitNum }),
    familyPortalRepo.countMedicationSchedules(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

// Prescription model status (UPPERCASE — unified after model fix)
const VALID_PRESCRIPTION_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED', 'PAUSED'];

/**
 * Danh sách đơn thuốc (Prescription), lọc theo trạng thái, tên thuốc.
 * UC: View Medication History
 */
const getPrescriptions = async (user, residentId, query) => {
  await assertResidentAccess(user._id, residentId);

  const filter = { residentId };
  if (query.status) {
    if (!VALID_PRESCRIPTION_STATUSES.includes(query.status)) {
      throw new ServiceError(`status phải là một trong: ${VALID_PRESCRIPTION_STATUSES.join(', ')}`, 400);
    }
    filter.status = query.status;
  }
  if (query.medicationName) {
    const rx = { $regex: query.medicationName.trim(), $options: 'i' };
    // Search in System A top-level medicationName AND System B items[].medicationName
    filter.$or = [
      { medicationName: rx },
      { 'items.medicationName': rx },
    ];
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    familyPortalRepo.findPrescriptions(filter, { sort: { prescriptionDate: -1 }, skip, limit: limitNum }),
    familyPortalRepo.countPrescriptions(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

// ─── Activity & Care Schedules ────────────────────────────────────────────────

const VALID_ACTIVITY_STATUSES = ['draft', 'scheduled', 'ongoing', 'completed', 'cancelled'];

/**
 * Lịch hoạt động sinh hoạt hằng ngày, phân trang, lọc trạng thái + ngày + tìm kiếm.
 * UC: View Daily Activity Schedule
 */
const getActivities = async (user, residentId, query) => {
  await assertResidentAccess(user._id, residentId);

  const filter = { participantResidentIds: residentId };
  if (query.status) {
    if (!VALID_ACTIVITY_STATUSES.includes(query.status)) {
      throw new ServiceError(`status phải là một trong: ${VALID_ACTIVITY_STATUSES.join(', ')}`, 400);
    }
    filter.status = query.status;
  }
  if (query.search) {
    filter.$or = [
      { title: { $regex: query.search.trim(), $options: 'i' } },
      { category: { $regex: query.search.trim(), $options: 'i' } },
    ];
  }
  if (query.from || query.to) {
    filter.scheduledAt = {};
    if (query.from) filter.scheduledAt.$gte = new Date(query.from);
    if (query.to) filter.scheduledAt.$lte = new Date(query.to);
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    familyPortalRepo.findActivities(filter, { sort: { scheduledAt: 1 }, skip, limit: limitNum }),
    familyPortalRepo.countActivities(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

const VALID_APPOINTMENT_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];

/**
 * Lịch chăm sóc và lịch khám bệnh phân trang, lọc trạng thái + ngày + loại hẹn.
 * UC: View Medical and Care Schedules
 */
const getCareAppointments = async (user, residentId, query) => {
  await assertResidentAccess(user._id, residentId);

  const filter = { residentId };
  if (query.status) {
    if (!VALID_APPOINTMENT_STATUSES.includes(query.status)) {
      throw new ServiceError(`status phải là một trong: ${VALID_APPOINTMENT_STATUSES.join(', ')}`, 400);
    }
    filter.status = query.status;
  }
  if (query.appointmentType) {
    filter.appointmentType = { $regex: query.appointmentType.trim(), $options: 'i' };
  }
  if (query.from || query.to) {
    filter.scheduledStartAt = {};
    if (query.from) filter.scheduledStartAt.$gte = new Date(query.from);
    if (query.to) filter.scheduledStartAt.$lte = new Date(query.to);
  }

  const { pageNum, limitNum, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    familyPortalRepo.findCareAppointments(filter, { sort: { scheduledStartAt: 1 }, skip, limit: limitNum }),
    familyPortalRepo.countCareAppointments(filter),
  ]);

  return { data, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};

// ─── Health Report (JSON) ─────────────────────────────────────────────────────

/**
 * Báo cáo sức khỏe tổng hợp (JSON). Giới hạn 200 bản ghi mỗi section để tránh quá tải.
 * UC: Remote Monitoring / Download Health Reports (JSON version)
 */
const getHealthReport = async (user, residentId, query) => {
  await assertResidentAccess(user._id, residentId);

  const dateRange = {};
  if (query.from) dateRange.$gte = new Date(query.from);
  if (query.to) dateRange.$lte = new Date(query.to);
  const hasRange = Object.keys(dateRange).length > 0;

  const resident = await familyPortalRepo.getResidentById(residentId);
  if (!resident) throw new ServiceError('Không tìm thấy cư dân', 404);

  const vitalsFilter = { residentId, ...(hasRange && { measuredAt: dateRange }) };
  const notesFilter  = { residentId, ...(hasRange && { noteAt: dateRange }) };
  const apptFilter   = { residentId, ...(hasRange && { scheduledStartAt: dateRange }) };
  const medFilter    = { residentId, ...(hasRange && { scheduledTime: dateRange }) };

  const [vitals, careNotes, careAppointments, medications, prescriptions] = await Promise.all([
    familyPortalRepo.findMedicalRecords(vitalsFilter, { sort: { measuredAt: -1 }, limit: 200 }),
    familyPortalRepo.findCareNotes(notesFilter, { sort: { noteAt: -1 }, limit: 200 }),
    familyPortalRepo.findCareAppointments(apptFilter, { sort: { scheduledStartAt: -1 }, limit: 100 }),
    familyPortalRepo.findMedicationSchedules(medFilter, { sort: { scheduledTime: -1 }, limit: 200 }),
    familyPortalRepo.findPrescriptions({ residentId }, { sort: { startDate: -1 }, limit: 50 }),
  ]);

  return {
    generatedAt: new Date(),
    period: { from: query.from || null, to: query.to || null },
    resident,
    summary: {
      totalVitalsRecords: vitals.length,
      totalCareNotes: careNotes.length,
      totalAppointments: careAppointments.length,
      totalMedications: medications.length,
      totalPrescriptions: prescriptions.length,
    },
    vitals,
    careNotes,
    careAppointments,
    medications,
    prescriptions,
  };
};

// ─── Health Report Download (CSV) ────────────────────────────────────────────

const escapeCell = (val) => {
  if (val == null) return '';
  const str = String(val);
  return str.includes(',') || str.includes('"') || str.includes('\n')
    ? `"${str.replace(/"/g, '""')}"`
    : str;
};

const csvRow = (...cols) => cols.map(escapeCell).join(',');

const fmtDate = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '');

const buildCsv = (report) => {
  const res = report.resident;
  const lines = [];

  // ── Tiêu đề báo cáo ──────────────────────────────────────────────────────
  lines.push('BÁO CÁO SỨC KHỎE');
  lines.push(csvRow('Thời gian xuất:', fmtDate(report.generatedAt)));
  lines.push(csvRow('Cư dân:', `${res.fullName || ''} (${res.residentCode || ''})`));
  lines.push(csvRow('Trạng thái:', res.residencyStatus || ''));
  lines.push(csvRow('Kỳ báo cáo từ:', report.period.from ? fmtDate(report.period.from) : 'Tất cả'));
  lines.push(csvRow('Kỳ báo cáo đến:', report.period.to ? fmtDate(report.period.to) : 'Hiện tại'));
  lines.push('');

  // ── Chỉ số sức khỏe ───────────────────────────────────────────────────────
  lines.push('CHỈ SỐ SỨC KHỎE');
  lines.push(csvRow(
    'Thời gian đo', 'HA Tâm thu (mmHg)', 'HA Tâm trương (mmHg)',
    'Mạch (lần/phút)', 'Nhiệt độ (°C)', 'SpO2 (%)',
    'Đường huyết (mmol/L)', 'Cân nặng (kg)', 'Bất thường', 'Ghi chú',
  ));
  for (const v of report.vitals) {
    const doc = v.toObject ? v.toObject() : v;
    lines.push(csvRow(
      fmtDate(doc.measuredAt),
      doc.bloodPressureSystolic,
      doc.bloodPressureDiastolic,
      doc.pulse,
      doc.temperatureCelsius,
      doc.oxygenSaturation,
      doc.bloodSugar,
      doc.weightKg,
      doc.abnormalFlag ? 'Có' : 'Không',
      doc.summary,
    ));
  }
  lines.push('');

  // ── Nhật ký chăm sóc ──────────────────────────────────────────────────────
  lines.push('NHẬT KÝ CHĂM SÓC');
  lines.push(csvRow('Thời gian', 'Loại', 'Nội dung'));
  for (const n of report.careNotes) {
    const doc = n.toObject ? n.toObject() : n;
    lines.push(csvRow(fmtDate(doc.noteAt), doc.noteType, doc.content));
  }
  lines.push('');

  // ── Lịch sử dùng thuốc ────────────────────────────────────────────────────
  lines.push('LỊCH SỬ DÙNG THUỐC');
  lines.push(csvRow(
    'Giờ dự kiến', 'Tên thuốc', 'Liều lượng',
    'Trạng thái', 'Giờ thực tế', 'Lý do bỏ lỡ',
  ));
  for (const m of report.medications) {
    const doc = m.toObject ? m.toObject() : m;
    lines.push(csvRow(
      fmtDate(doc.scheduledTime),
      doc.medicationName,
      doc.dosage,
      doc.status,
      fmtDate(doc.actualTimeTaken),
      doc.missedReason,
    ));
  }
  lines.push('');

  // ── Đơn thuốc ─────────────────────────────────────────────────────────────
  lines.push('ĐƠN THUỐC');
  lines.push(csvRow('Tên thuốc', 'Liều dùng', 'Đường dùng', 'Tần suất', 'Ngày bắt đầu', 'Ngày kết thúc', 'Trạng thái'));
  for (const p of report.prescriptions) {
    const doc = p.toObject ? p.toObject() : p;
    lines.push(csvRow(
      doc.medicationName,
      doc.dosage,
      doc.route,
      doc.frequency,
      fmtDate(doc.startDate),
      fmtDate(doc.endDate),
      doc.status,
    ));
  }
  lines.push('');

  // ── Lịch chăm sóc & khám bệnh ────────────────────────────────────────────
  lines.push('LỊCH CHĂM SÓC & KHÁM BỆNH');
  lines.push(csvRow('Thời gian bắt đầu', 'Thời gian kết thúc', 'Loại hẹn', 'Trạng thái', 'Ghi chú'));
  for (const a of report.careAppointments) {
    const doc = a.toObject ? a.toObject() : a;
    lines.push(csvRow(
      fmtDate(doc.scheduledStartAt),
      fmtDate(doc.scheduledEndAt),
      doc.appointmentType,
      doc.status,
      doc.notes,
    ));
  }

  return lines.join('\n');
};

/**
 * Tải báo cáo sức khỏe dưới dạng CSV (UTF-8 có BOM để Excel đọc đúng tiếng Việt).
 * UC: Download Health Reports
 */
const downloadHealthReport = async (user, residentId, query) => {
  const report = await getHealthReport(user, residentId, query);
  const csv = buildCsv(report);
  const residentCode = (report.resident.residentCode || 'resident').toLowerCase();
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `health-report-${residentCode}-${dateStr}.csv`;
  return { csv, filename };
};

module.exports = {
  getResidents,
  getResident,
  getVitals,
  getHealthHistory,
  getHealthChart,
  getCareNotes,
  getMedications,
  getPrescriptions,
  getActivities,
  getCareAppointments,
  getHealthReport,
  downloadHealthReport,
};

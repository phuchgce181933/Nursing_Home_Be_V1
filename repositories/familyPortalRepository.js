const Resident = require('../models/resident');
const MedicalRecord = require('../models/medicalRecord');
const CareNote = require('../models/careNote');
const MedicationSchedule = require('../models/MedicationSchedule');
const Prescription = require('../models/prescription');
const Activity = require('../models/activity');
const CareAppointment = require('../models/careAppointment');
const CareTask = require('../models/careTask');
const HygieneActivityRecord = require('../models/hygieneActivityRecord');
const MealIntakeNote = require('../models/mealIntakeNote');
const DailyBehaviorRecord = require('../models/dailyBehaviorRecord');
const CareScheduleDay = require('../models/careScheduleDay');
const CareScheduleEntry = require('../models/careScheduleEntry');
const Invoice = require('../models/invoice');

const getFamilyResidentIds = async (userId) => {
  const residents = await Resident.find({ familyPortalAccountIds: userId }, '_id');
  return residents.map((r) => r._id.toString());
};

const getResidentsForFamily = async (userId) =>
  Resident.find({ familyPortalAccountIds: userId, residencyStatus: 'admitted' })
    .select('residentCode fullName dateOfBirth gender bloodType avatarUrl allergies chronicConditions residencyStatus admittedAt roomId bedId servicePackage')
    .populate('roomId', 'roomNumber')
    .populate('bedId', 'bedCode');

const getResidentById = async (residentId) =>
  Resident.findById(residentId)
    .select('-familyPortalAccountIds')
    .populate('roomId', 'roomNumber')
    .populate('bedId', 'bedCode');

const findMedicalRecords = async (filter, { sort = { measuredAt: -1 }, skip = 0, limit = 20 } = {}) =>
  MedicalRecord.find(filter).sort(sort).skip(skip).limit(limit);

const countMedicalRecords = async (filter) => MedicalRecord.countDocuments(filter);

const findCareNotes = async (filter, { sort = { noteAt: -1 }, skip = 0, limit = 20 } = {}) =>
  CareNote.find(filter)
    .populate({ path: 'authorStaffId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const countCareNotes = async (filter) => CareNote.countDocuments(filter);

const findInvoicesByResidentId = async (residentId, { sort = { issuedAt: -1 }, skip = 0, limit = 20 } = {}) =>
  // Filter out DRAFT invoices — they are admin-only (chưa xuất hóa đơn) until the
  // admin explicitly issues them. Family members should not see them.
  Invoice.find({ residentId, status: { $ne: 'DRAFT' } })
    .populate('prescriptionId', 'diagnosisNote prescriptionDate validUntil status items medicationId')
    .sort(sort)
    .skip(skip)
    .limit(limit);

const findLatestInvoiceByResidentId = async (residentId) =>
  Invoice.findOne({ residentId, status: { $ne: 'DRAFT' } })
    .populate('prescriptionId', 'diagnosisNote prescriptionDate validUntil status items medicationId')
    .sort({ issuedAt: -1 });

const countInvoicesByResidentId = async (residentId) =>
  Invoice.countDocuments({ residentId, status: { $ne: 'DRAFT' } });

const findInvoiceById = async (invoiceId) =>
  Invoice.findById(invoiceId)
    .populate('prescriptionId', 'diagnosisNote prescriptionDate validUntil status items medicationId');

const findInvoiceByIdAndResident = async (invoiceId, residentId) =>
  Invoice.findOne({ _id: invoiceId, residentId, status: { $ne: 'DRAFT' } })
    .populate({
      path: 'prescriptionId',
      select: 'diagnosisNote prescriptionDate validUntil status items medicationId',
      populate: {
        path: 'items.medicationId',
        select: 'name genericName unit price'
      }
    });

// MedicationSchedule (replaces MedicationAdministration for the new medication management module)
const findMedicationSchedules = async (filter, { sort = { scheduledTime: -1 }, skip = 0, limit = 20 } = {}) =>
  MedicationSchedule.find(filter)
    .populate('prescriptionId', 'diagnosisNote prescriptionDate validUntil status')
    .populate('markedBy', 'fullName')
    .sort(sort)
    .skip(skip)
    .limit(limit);

const countMedicationSchedules = async (filter) => MedicationSchedule.countDocuments(filter);

// Unpaged variant for history/compliance stats and daily-schedule views, where every
// matching record within the (bounded) date range must be aggregated, not just a page.
const findMedicationSchedulesUnpaged = async (filter, { sort = { scheduledTime: 1 } } = {}) =>
  MedicationSchedule.find(filter)
    .populate('markedBy', 'fullName role')
    .sort(sort);

// doctorId in new Prescription refs User directly (not StaffProfile)
const findPrescriptions = async (filter, { sort = { prescriptionDate: -1 }, skip = 0, limit = 100 } = {}) =>
  Prescription.find(filter)
    .populate('doctorId', 'fullName email')
    .sort(sort)
    .skip(skip)
    .limit(limit);

// Danh sách trạng thái hoá đơn ĐƯỢC COI LÀ "đã phát hành hợp lệ cho người thân".
// Dùng allow-list tường minh trên đúng các giá trị enum của Invoice thay vì điều kiện
// phủ định (`$ne: 'DRAFT'`), vì:
//   • ISSUED / PARTIALLY_PAID / PAID = đã xuất cho người thân → HIỂN THỊ (vẫn hiển thị
//     sau khi thanh toán — cổng là "đã phát hành", không phải "đang nợ").
//   • DRAFT = bản nháp của admin, chưa xuất → ẨN.
//   • CANCELLED = với hoá đơn THUỐC, con đường DUY NHẤT tới CANCELLED là bị "Dừng"
//     (soft-delete) khi còn DRAFT (contractService.softDeleteDraftInvoice chỉ cho phép
//     DRAFT) → tức là CHƯA BAO GIỜ được phát hành hợp lệ → ẨN. Không có luồng nào huỷ
//     một hoá đơn thuốc đã ISSUED (các luồng huỷ hợp đồng/đổi gói chỉ chạm SERVICE/
//     COMBINED, không chạm MEDICATION), nên loại CANCELLED khỏi allow-list là an toàn.
const FAMILY_VISIBLE_INVOICE_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'PAID'];

// Trong số các đơn thuốc truyền vào, trả về những đơn ĐÃ được phát hành hoá đơn thuốc
// hợp lệ cho người thân — tồn tại một Invoice liên kết bằng prescriptionId (quan hệ có
// cấu trúc, KHÔNG dò theo tên/số tiền), trạng thái nằm trong allow-list ở trên và chưa
// bị soft-delete (deletedAt = null, phòng vệ theo lớp — soft-delete luôn kèm CANCELLED).
const findIssuedPrescriptionIds = async (prescriptionIds) => {
  if (!Array.isArray(prescriptionIds) || prescriptionIds.length === 0) return [];
  const invoices = await Invoice.find({
    prescriptionId: { $in: prescriptionIds },
    status: { $in: FAMILY_VISIBLE_INVOICE_STATUSES },
    deletedAt: null,
  })
    .select('prescriptionId')
    .lean();
  return invoices.map((inv) => inv.prescriptionId).filter(Boolean);
};

const findActivities = async (filter, { sort = { scheduledAt: 1 }, skip = 0, limit = 100 } = {}) =>
  Activity.find(filter).sort(sort).skip(skip).limit(limit);

const findCareAppointments = async (filter, { sort = { scheduledStartAt: 1 }, skip = 0, limit = 100 } = {}) =>
  CareAppointment.find(filter)
    .populate({ path: 'doctorStaffId', populate: { path: 'userId', select: 'fullName' } })
    .populate({ path: 'nurseStaffId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const findCareTasks = async (filter, { sort = { workDate: 1, scheduledTime: 1 }, skip = 0, limit = 200 } = {}) =>
  CareTask.find(filter)
    .populate({ path: 'staffProfileId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const findHygieneActivityRecords = async (filter, { sort = { workDate: 1, recordedAt: 1 }, skip = 0, limit = 200 } = {}) =>
  HygieneActivityRecord.find(filter)
    .populate({ path: 'recordedByStaffId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const findMealIntakeNotes = async (filter, { sort = { workDate: 1, mealType: 1 }, skip = 0, limit = 200 } = {}) =>
  MealIntakeNote.find(filter)
    .populate({ path: 'recordedByStaffId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const findDailyBehaviorRecords = async (filter, { sort = { workDate: 1, observedAt: 1 }, skip = 0, limit = 200 } = {}) =>
  DailyBehaviorRecord.find(filter)
    .populate({ path: 'recordedByStaffId', populate: { path: 'userId', select: 'fullName' } })
    .sort(sort)
    .skip(skip)
    .limit(limit);

const findPublishedCareScheduleDays = async (dateFilter) => {
  const filter = { status: 'published' };
  if (Object.keys(dateFilter).length > 0) filter.workDate = dateFilter;
  return CareScheduleDay.find(filter).select('_id workDate title status publishedAt').sort({ workDate: 1 });
};

const findCareScheduleEntries = async (filter, { sort = { scheduledTime: 1 }, skip = 0, limit = 500 } = {}) =>
  CareScheduleEntry.find(filter)
    .populate({ path: 'staffProfileId', populate: { path: 'userId', select: 'fullName' } })
    .populate('careScheduleDayId', 'workDate title status')
    .sort(sort)
    .skip(skip)
    .limit(limit);

module.exports = {
  getFamilyResidentIds,
  getResidentsForFamily,
  getResidentById,
  findMedicalRecords,
  countMedicalRecords,
  findCareNotes,
  countCareNotes,
  findMedicationSchedules,
  countMedicationSchedules,
  findMedicationSchedulesUnpaged,
  findPrescriptions,
  findIssuedPrescriptionIds,
  findActivities,
  findCareAppointments,
  findCareTasks,
  findHygieneActivityRecords,
  findMealIntakeNotes,
  findDailyBehaviorRecords,
  findPublishedCareScheduleDays,
  findCareScheduleEntries,
  findInvoicesByResidentId,
  findLatestInvoiceByResidentId,
  countInvoicesByResidentId,
  findInvoiceByIdAndResident,
};

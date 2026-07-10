const User = require('./user');
const Building = require('./building');
const Floor = require('./floor');
const Room = require('./room');
const Bed = require('./bed');
const Equipment = require('./equipment');
const Resident = require('./resident');
const Admission = require('./admission');
const StaffProfile = require('./staffProfile');
const Shift = require('./shift');
const ShiftTemplate = require('./shiftTemplate');
const Activity = require('./activity');
const MedicalRecord = require('./medicalRecord');
const Prescription = require('./prescription');
const MedicationAdministration = require('./medicationAdministration');
const Medication = require('./medication');
const MedicationStock = require('./medicationStock');
const MedicationDispense = require('./medicationDispense');
const MedicationNote = require('./medicationNote');
const Supplier = require('./supplier');
const Incident = require('./incident');
const CareAppointment = require('./careAppointment');
const CareNote = require('./careNote');
const Invoice = require('./invoice');
const Payment = require('./payment');
const Notification = require('./notification');
const SupportRequest = require('./supportRequest');
const Conversation = require('./conversation');
const Message = require('./message');
const AuditLog = require('./auditLog');
const ReportSnapshot = require('./reportSnapshot');
const CareTask = require('./careTask');
const CareScheduleDay = require('./careScheduleDay');
const CareScheduleEntry = require('./careScheduleEntry');
const MealPlanDay = require('./mealPlanDay');
const MealPlanEntry = require('./mealPlanEntry');
const SpecialDietDay = require('./specialDietDay');
const SpecialDietEntry = require('./specialDietEntry');
const MealTimeScheduleDay = require('./mealTimeScheduleDay');
const MealTimeScheduleEntry = require('./mealTimeScheduleEntry');
const MealIntakeNote = require('./mealIntakeNote');
const HygieneActivityRecord = require('./hygieneActivityRecord');
const DailyBehaviorRecord = require('./dailyBehaviorRecord');
const LeaveRequest = require('./leaveRequest');
const FacilityTour = require('./facilityTour');
const ServicePackage = require('./servicePackage');
const MedicationSchedule = require('./MedicationSchedule');
const ContraindicationRule = require('./ContraindicationRule');
const DrugInteraction = require('./DrugInteraction');
const ElderlyDosageGuideline = require('./ElderlyDosageGuideline');
const FamilyWallet = require('./familyWallet');

module.exports = {
  User,
  Building,
  Floor,
  Room,
  Bed,
  Equipment,
  Resident,
  Admission,
  StaffProfile,
  Shift,
  ShiftTemplate,
  Activity,
  MedicalRecord,
  Prescription,
  MedicationAdministration,
  Medication,
  MedicationStock,
  MedicationDispense,
  MedicationNote,
  Supplier,
  Incident,
  CareAppointment,
  CareNote,
  Invoice,
  Payment,
  Notification,
  SupportRequest,
  Conversation,
  Message,
  AuditLog,
  ReportSnapshot,
  LeaveRequest,
  CareTask,
  CareScheduleDay,
  CareScheduleEntry,
  MealPlanDay,
  MealPlanEntry,
  SpecialDietDay,
  SpecialDietEntry,
  MealTimeScheduleDay,
  MealTimeScheduleEntry,
  MealIntakeNote,
  HygieneActivityRecord,
  DailyBehaviorRecord,
  FacilityTour,
  ServicePackage,
  MedicationSchedule,
  ContraindicationRule,
  DrugInteraction,
  ElderlyDosageGuideline,
  FamilyWallet,
};

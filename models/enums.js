const ROLES = ['admin', 'manager', 'doctor', 'nurse', 'caregiver', 'chef', 'pharmacist', 'family', 'staff'];
const NON_ASSIGNABLE_ROLES = ['admin', 'manager'];
const OPERATIONAL_ASSIGNABLE_ROLES = ['doctor', 'nurse', 'caregiver', 'staff'];
const CARE_TASK_ASSIGNEE_ROLES = ['nurse', 'doctor'];
const GENDERS = ['male', 'female', 'other', 'unknown'];
const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'];

const ROOM_TYPES = ['standard', 'premium', 'icu', 'isolation'];
const ROOM_STATUSES = ['available', 'full', 'maintenance', 'closed'];
const BED_TYPES = ['normal', 'electric', 'icu'];
const BED_STATUSES = ['available', 'occupied', 'reserved', 'maintenance'];
const BED_CONDITIONS = ['good', 'fair', 'broken'];
const EQUIPMENT_STATUSES = ['available', 'in_use', 'maintenance', 'retired'];
const EQUIPMENT_LOCATION_TYPES = ['building', 'floor', 'room', 'bed', 'storage'];

const RESIDENCY_STATUSES = ['pending', 'admitted', 'discharged', 'transferred', 'inactive'];
const ADMISSION_ELIGIBILITY_STATUSES = ['pending', 'eligible', 'not_eligible'];
const ADMISSION_STATUSES = ['new_request', 'consulting', 'assessing', 'contracting', 'checked_in', 'cancelled'];

const SHIFT_STATUSES = ['draft', 'published', 'confirmed', 'completed', 'cancelled'];
const SHIFT_TEMPLATE_STATUSES = ['active', 'inactive', 'archived'];
const SHIFT_TYPES = ['morning', 'afternoon', 'night', 'on_call', 'custom'];
const CONFLICT_TYPES = [
  'INVALID_TIME',
  'OVERLAP',
  'LEAVE_CONFLICT',
  'MULTIPLE_AREAS',
  'ROLE_MISMATCH',
  'STAFF_NOT_ASSIGNABLE',
  'PAST_DATE',
  'OVERTIME',
  'REST_VIOLATION',
  'UNDERSTAFFED',
];
const CONFLICT_SEVERITIES = ['ERROR', 'WARNING', 'INFO'];
const ACTIVITY_STATUSES = ['draft', 'scheduled', 'ongoing', 'completed', 'cancelled'];

const PRESCRIPTION_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'];
const MEDICATION_ADMIN_STATUSES = ['pending', 'taken', 'missed', 'overdue'];
const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const INCIDENT_STATUSES = ['open', 'investigating', 'resolved', 'closed'];
const APPOINTMENT_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];
const CARE_NOTE_TYPES = ['meal', 'activity', 'daily_living', 'health', 'general'];

const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled'];
const PAYMENT_METHODS = ['bank_transfer', 'card', 'wallet', 'cash'];
const PAYMENT_STATUSES = ['pending', 'confirmed', 'failed', 'refunded'];

const NOTIFICATION_CATEGORIES = ['incident', 'health', 'appointment', 'activity', 'billing', 'message', 'system'];
const DELIVERY_CHANNELS = ['in_app', 'email', 'sms', 'push'];
const SUPPORT_REQUEST_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const FACILITY_TOUR_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
const SERVICE_PACKAGE_TIERS = ['basic', 'standard', 'premium', 'vip'];

const LEAVE_REQUEST_TYPES = ['annual', 'sick', 'emergency', 'unpaid', 'other'];
const LEAVE_REQUEST_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'cancelled'];

const CARE_TASK_TYPES = ['morning_care', 'medication', 'physical_therapy', 'meal_assistance', 'evening_check', 'emergency_response'];
const CARE_TASK_STATUSES = ['pending', 'in_progress', 'completed', 'skipped', 'missed'];
const CARE_LEVELS = ['low', 'medium', 'high'];

module.exports = {
  ROLES,
  NON_ASSIGNABLE_ROLES,
  OPERATIONAL_ASSIGNABLE_ROLES,
  CARE_TASK_ASSIGNEE_ROLES,
  GENDERS,
  BLOOD_TYPES,
  ROOM_TYPES,
  ROOM_STATUSES,
  BED_TYPES,
  BED_STATUSES,
  BED_CONDITIONS,
  EQUIPMENT_STATUSES,
  EQUIPMENT_LOCATION_TYPES,
  RESIDENCY_STATUSES,
  ADMISSION_ELIGIBILITY_STATUSES,
  ADMISSION_STATUSES,
  SHIFT_STATUSES,
  SHIFT_TEMPLATE_STATUSES,
  SHIFT_TYPES,
  CONFLICT_TYPES,
  CONFLICT_SEVERITIES,
  ACTIVITY_STATUSES,
  PRESCRIPTION_STATUSES,
  MEDICATION_ADMIN_STATUSES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  APPOINTMENT_STATUSES,
  CARE_NOTE_TYPES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  NOTIFICATION_CATEGORIES,
  DELIVERY_CHANNELS,
  SUPPORT_REQUEST_STATUSES,
  FACILITY_TOUR_STATUSES,
  SERVICE_PACKAGE_TIERS,
  LEAVE_REQUEST_TYPES,
  LEAVE_REQUEST_STATUSES,
  CARE_TASK_TYPES,
  CARE_TASK_STATUSES,
  CARE_LEVELS,
};

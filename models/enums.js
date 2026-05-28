const ROLES = ['admin', 'manager', 'doctor', 'nurse', 'pharmacist', 'family', 'staff'];
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
const ACTIVITY_STATUSES = ['draft', 'scheduled', 'ongoing', 'completed', 'cancelled'];

const PRESCRIPTION_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'];
const MEDICATION_ADMIN_STATUSES = ['pending', 'taken', 'missed', 'overdue'];
const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const INCIDENT_STATUSES = ['open', 'investigating', 'resolved', 'closed'];
const APPOINTMENT_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];
const CARE_NOTE_TYPES = ['meal', 'activity', 'health', 'general'];

const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled'];
const PAYMENT_METHODS = ['bank_transfer', 'card', 'wallet', 'cash'];
const PAYMENT_STATUSES = ['pending', 'confirmed', 'failed', 'refunded'];

const NOTIFICATION_CATEGORIES = ['incident', 'health', 'appointment', 'activity', 'billing', 'message', 'system'];
const DELIVERY_CHANNELS = ['in_app', 'email', 'sms', 'push'];
const SUPPORT_REQUEST_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const FACILITY_TOUR_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
const SERVICE_PACKAGE_TIERS = ['basic', 'standard', 'premium', 'vip'];

module.exports = {
  ROLES,
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
};

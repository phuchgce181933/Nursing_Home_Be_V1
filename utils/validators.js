// Regex cho phép chữ cái Latin, chữ cái có dấu tiếng Việt, khoảng trắng, dấu gạch nối
const FULLNAME_REGEX = /^[\p{L}\s'\-\.]+$/u;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_REGEX = /^0\d{9}$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;
const PASSWORD_MIN = 8;

const validateFullName = (name) => {
  if (!name || !name.trim()) return 'fullName is required';
  if (name.trim().length < 2) return 'fullName must be at least 2 characters';
  if (name.trim().length > 100) return 'fullName must be at most 100 characters';
  if (!FULLNAME_REGEX.test(name.trim())) return 'fullName must not contain special characters';
  return null;
};

const validateEmail = (email) => {
  if (!email || !email.trim()) return 'email is required';
  if (!EMAIL_REGEX.test(email.trim())) return 'email is invalid';
  return null;
};

const validatePhone = (phone) => {
  if (!phone) return null; // optional
  if (!PHONE_REGEX.test(phone.trim())) return 'phone must be exactly 10 digits starting with 0 (e.g. 0912345678)';
  return null;
};

const validateUsername = (username) => {
  if (!username) return null; // optional
  if (!USERNAME_REGEX.test(username.trim())) return 'username must be 3–30 characters and contain only letters, digits, or underscores';
  return null;
};

const validatePassword = (password) => {
  if (!password) return 'password is required';
  if (password.length < PASSWORD_MIN) return `password must be at least ${PASSWORD_MIN} characters`;
  if (!/[a-zA-Z]/.test(password)) return 'password must contain at least one letter';
  if (!/[0-9]/.test(password)) return 'password must contain at least one digit';
  return null;
};

const validateDateOfBirth = (dob) => {
  if (!dob) return null; // optional
  const d = new Date(dob);
  if (isNaN(d.getTime())) return 'dateOfBirth is not a valid date';
  if (d > new Date()) return 'dateOfBirth cannot be in the future';
  const minAge = new Date();
  minAge.setFullYear(minAge.getFullYear() - 18);
  if (d > minAge) return 'staff must be at least 18 years old';
  return null;
};

const STAFF_DOB_GENDERS = ['male', 'female'];

const validateStaffDateOfBirth = (dob, { gender } = {}) => {
  if (!dob) return 'dateOfBirth is required';
  const d = new Date(dob);
  if (isNaN(d.getTime())) return 'dateOfBirth is not a valid date';
  if (d > new Date()) return 'dateOfBirth cannot be in the future';

  if (!STAFF_DOB_GENDERS.includes(gender)) {
    return 'gender must be male or female when date of birth is provided';
  }

  const minBirthDate = new Date();
  minBirthDate.setFullYear(minBirthDate.getFullYear() - 18);
  if (d > minBirthDate) {
    return 'staff must be at least 18 years old';
  }

  return null;
};

const collectErrors = (checks) => {
  const errors = checks.map((fn) => fn()).filter(Boolean);
  return errors.length ? errors.join('; ') : null;
};

// Escapes regex metacharacters so user-supplied search text is safe to embed in `new RegExp()`.
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ROLES_REQUIRING_CERT = ['doctor', 'nurse'];
const CERTIFICATE_MAX_AGE_YEARS = 5;

const validateStaffCertifications = (role, certificationDocuments) => {
  if (!ROLES_REQUIRING_CERT.includes(role)) return null;

  const docs = Array.isArray(certificationDocuments) ? certificationDocuments : [];
  if (docs.length === 0) {
    return 'at least one certification document is required for doctor/nurse';
  }

  const now = new Date();
  now.setHours(23, 59, 59, 999);

  const minDate = new Date();
  minDate.setFullYear(minDate.getFullYear() - CERTIFICATE_MAX_AGE_YEARS);
  minDate.setHours(0, 0, 0, 0);

  for (const doc of docs) {
    if (!doc?.issueDate) {
      return 'each certification must have an issue date';
    }
    const d = new Date(doc.issueDate);
    if (Number.isNaN(d.getTime())) {
      return 'certification issue date is not a valid date';
    }
    if (d > now) {
      return 'certification issue date cannot be in the future';
    }
    if (d < minDate) {
      return `certification has expired (older than ${CERTIFICATE_MAX_AGE_YEARS} years)`;
    }
  }

  return null;
};

module.exports = {
  validateFullName,
  validateEmail,
  validatePhone,
  validateUsername,
  validatePassword,
  validateDateOfBirth,
  validateStaffDateOfBirth,
  validateStaffCertifications,
  collectErrors,
  escapeRegex,
  ROLES_REQUIRING_CERT,
  CERTIFICATE_MAX_AGE_YEARS,
};

// Regex cho phép chữ cái Latin, chữ cái có dấu tiếng Việt, khoảng trắng, dấu gạch nối
const FULLNAME_REGEX = /^[\p{L}\s'\-\.]+$/u;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_REGEX = /^(\+84|0)[0-9]{8,10}$/;
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
  if (!PHONE_REGEX.test(phone.trim())) return 'phone must be a valid Vietnamese phone number (e.g. 0912345678 or +84912345678)';
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

const collectErrors = (checks) => {
  const errors = checks.map((fn) => fn()).filter(Boolean);
  return errors.length ? errors.join('; ') : null;
};

module.exports = {
  validateFullName,
  validateEmail,
  validatePhone,
  validateUsername,
  validatePassword,
  validateDateOfBirth,
  collectErrors,
};

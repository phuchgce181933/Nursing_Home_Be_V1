const { isValidObjectId } = require('mongoose');

const VALID_ROUTES = ['oral', 'injection', 'topical', 'inhaled'];
const MAX_DAYS = 30;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const isIso8601 = (v) => !isNaN(new Date(v).getTime());

const addError = (errors, field, msg) => errors.push({ field, message: msg });

// ── Shared item validators ────────────────────────────────────────────────────

const validateItem = (item, i, errors, requireAll = false) => {
  if (requireAll) {
    if (!item.medicationName) addError(errors, `items[${i}].medicationName`, 'medicationName is required');
    if (!item.dosage) addError(errors, `items[${i}].dosage`, 'dosage is required');
    if (!item.frequency) addError(errors, `items[${i}].frequency`, 'frequency is required');
  } else {
    if (item.medicationName !== undefined && !item.medicationName)
      addError(errors, `items[${i}].medicationName`, 'medicationName cannot be empty');
  }

  if (item.dosage !== undefined && !(parseFloat(item.dosage) > 0))
    addError(errors, `items[${i}].dosage`, 'dosage must be a positive number');

  if (item.frequency !== undefined) {
    const f = parseInt(item.frequency, 10);
    if (isNaN(f) || f < 1 || f > 4)
      addError(errors, `items[${i}].frequency`, 'frequency must be an integer between 1 and 4');
  }

  if (item.route !== undefined && !VALID_ROUTES.includes(item.route))
    addError(errors, `items[${i}].route`, `route must be one of: ${VALID_ROUTES.join(', ')}`);

  if (item.startDate !== undefined && item.startDate !== null && !isIso8601(item.startDate))
    addError(errors, `items[${i}].startDate`, 'startDate must be a valid ISO date');

  if (item.endDate !== undefined && item.endDate !== null && !isIso8601(item.endDate))
    addError(errors, `items[${i}].endDate`, 'endDate must be a valid ISO date');

  if (Array.isArray(item.times)) {
    const freq = parseInt(item.frequency, 10);
    if (!isNaN(freq) && item.times.length !== freq)
      addError(errors, `items[${i}].times`, `times must have exactly ${freq} entries (matching frequency)`);
    item.times.forEach((t, ti) => {
      if (!TIME_REGEX.test(t))
        addError(errors, `items[${i}].times[${ti}]`, 'time entries must be HH:MM format (e.g. "08:00")');
    });
  }

  if (item.startDate && item.endDate) {
    const start = new Date(item.startDate);
    const end = new Date(item.endDate);
    if (end <= start)
      addError(errors, `items[${i}].endDate`, 'endDate must be after startDate');
    else if (item.duration) {
      const expected = new Date(start);
      expected.setDate(expected.getDate() + parseInt(item.duration, 10));
      if (Math.abs(end.getTime() - expected.getTime()) > 24 * 60 * 60 * 1000)
        addError(errors, `items[${i}].endDate`,
          `endDate should be startDate + ${item.duration} days (expected ~${expected.toISOString().slice(0, 10)})`);
    }
  }
};

// ── Middleware factories ───────────────────────────────────────────────────────

const createPrescriptionRules = (req, res, next) => {
  const errors = [];
  const { residentId, diagnosisNote, validUntil, items } = req.body;

  if (!residentId) addError(errors, 'residentId', 'residentId is required');
  else if (!isValidObjectId(residentId)) addError(errors, 'residentId', 'residentId must be a valid ObjectId');

  if (!diagnosisNote) addError(errors, 'diagnosisNote', 'diagnosisNote is required');
  else if (String(diagnosisNote).trim().length < 10)
    addError(errors, 'diagnosisNote', 'diagnosisNote must be at least 10 characters');

  if (!validUntil) {
    addError(errors, 'validUntil', 'validUntil is required');
  } else if (!isIso8601(validUntil)) {
    addError(errors, 'validUntil', 'validUntil must be a valid ISO date');
  } else {
    const until = new Date(validUntil);
    const now = new Date();
    if (until <= now) addError(errors, 'validUntil', 'validUntil must be a future date');
    const max = new Date();
    max.setDate(now.getDate() + MAX_DAYS);
    if (until > max)
      addError(errors, 'validUntil', `validUntil must be within ${MAX_DAYS} days from today (Thông tư 52/2017/TT-BYT)`);
  }

  if (!Array.isArray(items) || items.length === 0)
    addError(errors, 'items', 'items must be an array with at least 1 item');
  else items.forEach((item, i) => validateItem(item, i, errors, true));

  req._validationErrors = errors;
  next();
};

const editPrescriptionRules = (req, res, next) => {
  const errors = [];
  const { diagnosisNote, validUntil, items } = req.body;

  if (diagnosisNote !== undefined && String(diagnosisNote).trim().length < 10)
    addError(errors, 'diagnosisNote', 'diagnosisNote must be at least 10 characters');

  if (validUntil !== undefined) {
    if (!isIso8601(validUntil)) {
      addError(errors, 'validUntil', 'validUntil must be a valid ISO date');
    } else {
      const until = new Date(validUntil);
      const now = new Date();
      if (until <= now) addError(errors, 'validUntil', 'validUntil must be a future date');
      const max = new Date();
      max.setDate(now.getDate() + MAX_DAYS);
      if (until > max)
        addError(errors, 'validUntil', `validUntil must be within ${MAX_DAYS} days from today (Thông tư 52/2017/TT-BYT)`);
    }
  }

  if (items !== undefined) {
    if (!Array.isArray(items) || items.length === 0)
      addError(errors, 'items', 'items must be an array with at least 1 item');
    else {
      items.forEach((item, i) => {
        if (item._id !== undefined && !isValidObjectId(item._id))
          addError(errors, `items[${i}]._id`, 'items[*]._id must be a valid ObjectId');
        validateItem(item, i, errors, false);
      });
    }
  }

  req._validationErrors = errors;
  next();
};

const validate = (req, res, next) => {
  const errors = req._validationErrors || [];
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      errorCode: 'VALIDATION_ERROR',
      errors,
    });
  }
  next();
};

module.exports = { createPrescriptionRules, editPrescriptionRules, validate };

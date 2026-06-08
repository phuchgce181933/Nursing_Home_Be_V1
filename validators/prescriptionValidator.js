const { body, validationResult } = require('express-validator');

const VALID_ROUTES = ['oral', 'injection', 'topical', 'inhaled'];
const MAX_DAYS = 30;

const createPrescriptionRules = [
  body('residentId')
    .notEmpty().withMessage('residentId is required')
    .isMongoId().withMessage('residentId must be a valid ObjectId'),

  body('diagnosisNote')
    .notEmpty().withMessage('diagnosisNote is required')
    .isLength({ min: 10 }).withMessage('diagnosisNote must be at least 10 characters'),

  body('validUntil')
    .notEmpty().withMessage('validUntil is required')
    .isISO8601().withMessage('validUntil must be a valid ISO date')
    .custom((value) => {
      const until = new Date(value);
      const now = new Date();
      if (until <= now) throw new Error('validUntil must be a future date');
      const max = new Date();
      max.setDate(now.getDate() + MAX_DAYS);
      if (until > max) {
        throw new Error(`validUntil must be within ${MAX_DAYS} days from today (Thông tư 52/2017/TT-BYT)`);
      }
      return true;
    }),

  body('items')
    .isArray({ min: 1 }).withMessage('items must be an array with at least 1 item'),

  // Doctor selects medication from pharmacy DB — medicationId required, not free-text name
  body('items.*.medicationId')
    .notEmpty().withMessage('items[*].medicationId is required')
    .isMongoId().withMessage('items[*].medicationId must be a valid ObjectId'),

  body('items.*.dosage')
    .notEmpty().withMessage('items[*].dosage is required')
    .isFloat({ gt: 0 }).withMessage('items[*].dosage must be a positive number'),

  body('items.*.frequency')
    .notEmpty().withMessage('items[*].frequency is required')
    .isInt({ min: 1, max: 4 }).withMessage('items[*].frequency must be an integer between 1 and 4'),

  body('items.*.times')
    .optional()
    .isArray().withMessage('items[*].times must be an array'),

  body('items.*.route')
    .optional()
    .isIn(VALID_ROUTES).withMessage(`items[*].route must be one of: ${VALID_ROUTES.join(', ')}`),

  body('items.*.startDate')
    .optional({ nullable: true })
    .isISO8601().withMessage('items[*].startDate must be a valid ISO date'),

  body('items.*.endDate')
    .optional({ nullable: true })
    .isISO8601().withMessage('items[*].endDate must be a valid ISO date'),

  // Cross-field: times.length == frequency, date ordering, endDate vs duration
  body('items').custom((items) => {
    if (!Array.isArray(items)) return true;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (Array.isArray(item.times) && item.frequency !== undefined) {
        const freq = parseInt(item.frequency, 10);
        if (item.times.length !== freq) {
          throw new Error(`items[${i}].times must have exactly ${freq} entries (matching frequency)`);
        }
      }
      if (item.startDate && item.endDate) {
        const start = new Date(item.startDate);
        const end = new Date(item.endDate);
        if (end <= start) throw new Error(`items[${i}].endDate must be after startDate`);
        if (item.duration) {
          const expected = new Date(start);
          expected.setDate(expected.getDate() + parseInt(item.duration, 10));
          if (Math.abs(end.getTime() - expected.getTime()) > 24 * 60 * 60 * 1000) {
            throw new Error(
              `items[${i}].endDate should be startDate + ${item.duration} days` +
              ` (expected ~${expected.toISOString().slice(0, 10)})`
            );
          }
        }
      }
    }
    return true;
  }),
];

// Nurse: only _id + times/instructions per item.
// Doctor: medicationId required when replacing items[].
const editPrescriptionRules = [
  body('diagnosisNote')
    .optional()
    .isLength({ min: 10 }).withMessage('diagnosisNote must be at least 10 characters'),

  body('validUntil')
    .optional()
    .isISO8601().withMessage('validUntil must be a valid ISO date')
    .custom((value) => {
      const until = new Date(value);
      const now = new Date();
      if (until <= now) throw new Error('validUntil must be a future date');
      const max = new Date();
      max.setDate(now.getDate() + MAX_DAYS);
      if (until > max) {
        throw new Error(`validUntil must be within ${MAX_DAYS} days from today (Thông tư 52/2017/TT-BYT)`);
      }
      return true;
    }),

  body('items')
    .optional()
    .isArray({ min: 1 }).withMessage('items must be an array with at least 1 item'),

  // Nurse patch: _id required to identify item
  body('items.*._id')
    .optional()
    .isMongoId().withMessage('items[*]._id must be a valid ObjectId'),

  // Doctor replacement: medicationId required (validated deeper in controller)
  body('items.*.medicationId')
    .optional()
    .isMongoId().withMessage('items[*].medicationId must be a valid ObjectId'),

  body('items.*.dosage')
    .optional()
    .isFloat({ gt: 0 }).withMessage('items[*].dosage must be a positive number'),

  body('items.*.frequency')
    .optional()
    .isInt({ min: 1, max: 4 }).withMessage('items[*].frequency must be an integer between 1 and 4'),

  body('items.*.times')
    .optional()
    .isArray().withMessage('items[*].times must be an array'),

  body('items.*.route')
    .optional()
    .isIn(VALID_ROUTES).withMessage(`items[*].route must be one of: ${VALID_ROUTES.join(', ')}`),

  body('items.*.startDate')
    .optional({ nullable: true })
    .isISO8601().withMessage('items[*].startDate must be a valid ISO date'),

  body('items.*.endDate')
    .optional({ nullable: true })
    .isISO8601().withMessage('items[*].endDate must be a valid ISO date'),

  body('items').optional().custom((items) => {
    if (!Array.isArray(items)) return true;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (Array.isArray(item.times) && item.frequency !== undefined) {
        const freq = parseInt(item.frequency, 10);
        if (item.times.length !== freq) {
          throw new Error(`items[${i}].times must have exactly ${freq} entries (matching frequency)`);
        }
      }
      if (item.startDate && item.endDate) {
        const start = new Date(item.startDate);
        const end = new Date(item.endDate);
        if (end <= start) throw new Error(`items[${i}].endDate must be after startDate`);
        if (item.duration) {
          const expected = new Date(start);
          expected.setDate(expected.getDate() + parseInt(item.duration, 10));
          if (Math.abs(end.getTime() - expected.getTime()) > 24 * 60 * 60 * 1000) {
            throw new Error(
              `items[${i}].endDate should be startDate + ${item.duration} days` +
              ` (expected ~${expected.toISOString().slice(0, 10)})`
            );
          }
        }
      }
    }
    return true;
  }),
];

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errorCode: 'VALIDATION_ERROR',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

module.exports = { createPrescriptionRules, editPrescriptionRules, validate };

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
      if (until <= now) {
        throw new Error('validUntil must be a future date');
      }
      const max = new Date();
      max.setDate(now.getDate() + MAX_DAYS);
      if (until > max) {
        throw new Error(
          `validUntil must be within ${MAX_DAYS} days from today (Thông tư 52/2017/TT-BYT)`
        );
      }
      return true;
    }),

  body('items')
    .isArray({ min: 1 }).withMessage('items must be an array with at least 1 item'),

  body('items.*.medicationName')
    .notEmpty().withMessage('items[*].medicationName is required'),

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

  // Cross-field validation: times length, startDate/endDate order, endDate vs duration
  body('items').custom((items) => {
    if (!Array.isArray(items)) return true;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // times.length must equal frequency
      if (Array.isArray(item.times) && item.frequency !== undefined) {
        const freq = parseInt(item.frequency, 10);
        if (item.times.length !== freq) {
          throw new Error(
            `items[${i}].times must have exactly ${freq} entries (matching frequency)`
          );
        }
      }

      if (item.startDate && item.endDate) {
        const start = new Date(item.startDate);
        const end = new Date(item.endDate);

        // startDate must be before endDate
        if (end <= start) {
          throw new Error(`items[${i}].endDate must be after startDate`);
        }

        // endDate must equal startDate + duration days (within 1-day tolerance)
        if (item.duration) {
          const expected = new Date(start);
          expected.setDate(expected.getDate() + parseInt(item.duration, 10));
          const diffMs = Math.abs(end.getTime() - expected.getTime());
          if (diffMs > 24 * 60 * 60 * 1000) {
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

module.exports = { createPrescriptionRules, validate };

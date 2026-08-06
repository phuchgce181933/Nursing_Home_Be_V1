const { body, validationResult } = require('express-validator');

const VALID_ROUTES = ['oral', 'injection', 'topical', 'inhaled'];
const MAX_DAYS = 30;

// Date-only (UTC) comparison — ignores time-of-day so "today" is always valid.
const isDateStrInPast = (value) => {
  const startStr = new Date(value).toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);
  return startStr < todayStr;
};

const createPrescriptionRules = [
  body('residentId')
    .notEmpty().withMessage('residentId là bắt buộc')
    .isMongoId().withMessage('residentId phải là ObjectId hợp lệ'),

  body('diagnosisNote')
    .notEmpty().withMessage('diagnosisNote là bắt buộc')
    .isLength({ min: 10 }).withMessage('diagnosisNote phải có ít nhất 10 ký tự'),

  body('validUntil')
    .notEmpty().withMessage('validUntil là bắt buộc')
    .isISO8601().withMessage('validUntil phải là ngày ISO hợp lệ')
    .custom((value) => {
      const until = new Date(value);
      const now = new Date();
      if (until <= now) throw new Error('validUntil phải là ngày trong tương lai');
      const max = new Date();
      max.setDate(now.getDate() + MAX_DAYS);
      if (until > max) {
        throw new Error(`validUntil không được vượt quá ${MAX_DAYS} ngày kể từ hôm nay (Thông tư 52/2017/TT-BYT)`);
      }
      return true;
    }),

  body('items')
    .isArray({ min: 1 }).withMessage('items phải là một mảng có ít nhất 1 phần tử'),

  // Doctor selects medication from pharmacy DB — medicationId required, not free-text name
  body('items.*.medicationId')
    .notEmpty().withMessage('items[*].medicationId là bắt buộc')
    .isMongoId().withMessage('items[*].medicationId phải là ObjectId hợp lệ'),

  body('items.*.dosage')
    .notEmpty().withMessage('items[*].dosage là bắt buộc')
    .custom((value) => {
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new Error('items[*].dosage phải là một số');
      }
      if (num < 0) {
        throw new Error('items[*].dosage không được là số âm');
      }
      if (num === 0) {
        throw new Error('items[*].dosage phải lớn hơn 0');
      }
      return true;
    }),

  body('items.*.frequency')
    .notEmpty().withMessage('items[*].frequency là bắt buộc')
    .isInt({ min: 1, max: 4 }).withMessage('items[*].frequency phải là số nguyên từ 1 đến 4'),

  body('items.*.times')
    .optional()
    .isArray().withMessage('items[*].times phải là một mảng'),

  body('items.*.route')
    .optional()
    .isIn(VALID_ROUTES).withMessage(`items[*].route phải thuộc một trong: ${VALID_ROUTES.join(', ')}`),

  body('items.*.startDate')
    .notEmpty().withMessage('items[*].startDate là bắt buộc')
    .isISO8601().withMessage('items[*].startDate phải là ngày ISO hợp lệ')
    .custom((value) => {
      if (isDateStrInPast(value)) {
        throw new Error('items[*].startDate không được là ngày trong quá khứ');
      }
      return true;
    }),

  body('items.*.endDate')
    .optional({ nullable: true })
    .isISO8601().withMessage('items[*].endDate phải là ngày ISO hợp lệ'),

  // Cross-field: times.length == frequency, date ordering, endDate vs duration
  body('items').custom((items, { req }) => {
    if (!Array.isArray(items)) return true;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (Array.isArray(item.times) && item.frequency !== undefined) {
        const freq = parseInt(item.frequency, 10);
        if (item.times.length !== freq) {
          throw new Error(`items[${i}].times phải có đúng ${freq} mục (khớp với frequency)`);
        }
      }
      if (item.startDate && req.body.validUntil) {
        const start = new Date(item.startDate);
        const validUntil = new Date(req.body.validUntil);
        if (start > validUntil) {
          throw new Error(`items[${i}].startDate không được sau validUntil`);
        }
      }
      if (item.startDate && item.endDate) {
        const start = new Date(item.startDate);
        const end = new Date(item.endDate);
        if (end <= start) throw new Error(`items[${i}].endDate phải sau startDate`);
        if (item.duration) {
          const expected = new Date(start);
          expected.setDate(expected.getDate() + parseInt(item.duration, 10));
          if (Math.abs(end.getTime() - expected.getTime()) > 24 * 60 * 60 * 1000) {
            throw new Error(
              `items[${i}].endDate nên bằng startDate + ${item.duration} ngày` +
              ` (dự kiến ~${expected.toISOString().slice(0, 10)})`
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
    .isLength({ min: 10 }).withMessage('diagnosisNote phải có ít nhất 10 ký tự'),

  body('validUntil')
    .optional()
    .isISO8601().withMessage('validUntil phải là ngày ISO hợp lệ')
    .custom((value) => {
      const until = new Date(value);
      const now = new Date();
      if (until <= now) throw new Error('validUntil phải là ngày trong tương lai');
      const max = new Date();
      max.setDate(now.getDate() + MAX_DAYS);
      if (until > max) {
        throw new Error(`validUntil không được vượt quá ${MAX_DAYS} ngày kể từ hôm nay (Thông tư 52/2017/TT-BYT)`);
      }
      return true;
    }),

  body('items')
    .optional()
    .isArray({ min: 1 }).withMessage('items phải là một mảng có ít nhất 1 phần tử'),

  // Nurse patch: _id required to identify item
  body('items.*._id')
    .optional()
    .isMongoId().withMessage('items[*]._id phải là ObjectId hợp lệ'),

  // Doctor replacement: medicationId required (validated deeper in controller)
  body('items.*.medicationId')
    .optional()
    .isMongoId().withMessage('items[*].medicationId phải là ObjectId hợp lệ'),

  // Soft-delete patches ({_id, isActive:false}) carry no dosage — only validate when present.
  body('items.*.dosage')
    .optional()
    .custom((value) => {
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new Error('items[*].dosage phải là một số');
      }
      if (num < 0) {
        throw new Error('items[*].dosage không được là số âm');
      }
      if (num === 0) {
        throw new Error('items[*].dosage phải lớn hơn 0');
      }
      return true;
    }),

  body('items.*.frequency')
    .optional()
    .isInt({ min: 1, max: 4 }).withMessage('items[*].frequency phải là số nguyên từ 1 đến 4'),

  body('items.*.times')
    .optional()
    .isArray().withMessage('items[*].times phải là một mảng'),

  body('items.*.route')
    .optional()
    .isIn(VALID_ROUTES).withMessage(`items[*].route phải thuộc một trong: ${VALID_ROUTES.join(', ')}`),

  body('items.*.isActive')
    .optional()
    .isBoolean().withMessage('items[*].isActive phải là kiểu boolean'),

  body('items.*.startDate')
    .optional({ nullable: true })
    .isISO8601().withMessage('items[*].startDate phải là ngày ISO hợp lệ')
    .custom((value) => {
      if (isDateStrInPast(value)) {
        throw new Error('items[*].startDate không được là ngày trong quá khứ');
      }
      return true;
    }),

  body('items.*.endDate')
    .optional({ nullable: true })
    .isISO8601().withMessage('items[*].endDate phải là ngày ISO hợp lệ'),

  body('items').optional().custom((items) => {
    if (!Array.isArray(items)) return true;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Doctor adding/replacing a full item (has medicationId, not a soft-delete) must set startDate.
      if (item.medicationId && item.isActive !== false && !item.startDate) {
        throw new Error(`items[${i}].startDate là bắt buộc khi thêm hoặc thay thế một loại thuốc`);
      }
      if (Array.isArray(item.times) && item.frequency !== undefined) {
        const freq = parseInt(item.frequency, 10);
        if (item.times.length !== freq) {
          throw new Error(`items[${i}].times phải có đúng ${freq} mục (khớp với frequency)`);
        }
      }
      if (item.startDate && item.endDate) {
        const start = new Date(item.startDate);
        const end = new Date(item.endDate);
        if (end <= start) throw new Error(`items[${i}].endDate phải sau startDate`);
        if (item.duration) {
          const expected = new Date(start);
          expected.setDate(expected.getDate() + parseInt(item.duration, 10));
          if (Math.abs(end.getTime() - expected.getTime()) > 24 * 60 * 60 * 1000) {
            throw new Error(
              `items[${i}].endDate nên bằng startDate + ${item.duration} ngày` +
              ` (dự kiến ~${expected.toISOString().slice(0, 10)})`
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

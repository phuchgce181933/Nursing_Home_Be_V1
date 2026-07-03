const { CODES, ERROR_MESSAGES } = require('../constants/apiErrorCodes');
const { SUCCESS, SUCCESS_MESSAGES } = require('../constants/apiSuccessCodes');

const interpolate = (template, params = {}) =>
  String(template).replace(/\{\{(\w+)\}\}/g, (_, key) =>
    params[key] != null ? String(params[key]) : `{{${key}}}`
  );

class ApiError extends Error {
  /**
   * @param {string} errorCode
   * @param {object} [options]
   * @param {number} [options.statusCode=400]
   * @param {string} [options.message]
   * @param {object} [options.params]
   * @param {Array} [options.conflicts]
   * @param {Array} [options.blockingTasks]
   */
  constructor(errorCode, { statusCode = 400, message, params, conflicts, blockingTasks } = {}) {
    const template = ERROR_MESSAGES[errorCode] || errorCode;
    const resolved = message || (params ? interpolate(template, params) : template);
    super(resolved);
    this.name = 'ApiError';
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.params = params;
    if (conflicts !== undefined) this.conflicts = conflicts;
    if (blockingTasks !== undefined) this.blockingTasks = blockingTasks;
  }
}

/**
 * Build a typed API error with stable errorCode for frontend i18n.
 * @param {string} code - value from CODES
 * @param {object} [options]
 * @param {number} [options.statusCode=400]
 * @param {string} [options.message] - override English/Vietnamese message from service
 * @param {object} [options.params] - interpolation params for ERROR_MESSAGES
 * @param {Array} [options.conflicts] - shift conflict details
 * @param {Array} [options.blockingTasks] - leave approval blocking tasks
 */
const apiErr = (code, { statusCode = 400, message, params, conflicts, blockingTasks } = {}) =>
  new ApiError(code, { statusCode, message, params, conflicts, blockingTasks });

/**
 * Build a success payload with stable messageKey for frontend i18n.
 * @param {string} messageKey - value from SUCCESS
 * @param {object} [options]
 * @param {string} [options.message] - override fallback message
 * @param {object} [options.params] - interpolation params for SUCCESS_MESSAGES
 */
const apiSuccess = (messageKey, { message, params, ...rest } = {}) => {
  const template = SUCCESS_MESSAGES[messageKey] || messageKey;
  const resolved = message || (params ? interpolate(template, params) : template);
  return {
    messageKey,
    message: resolved,
    ...(params && Object.keys(params).length ? { params } : {}),
    ...rest,
  };
};

module.exports = {
  ApiError,
  apiErr,
  apiSuccess,
  CODES,
  SUCCESS,
  interpolate,
};

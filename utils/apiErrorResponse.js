const ServiceError = require('../services/serviceError');
const { ApiError, CODES } = require('./apiError');

const isApiErrorLike = (err) =>
  err instanceof ApiError || (err && typeof err.errorCode === 'string');

const formatApiError = (err) => {
  if (isApiErrorLike(err)) {
    const payload = {
      message: err.message,
      errorCode: err.errorCode,
    };
    if (err.params && Object.keys(err.params).length) {
      payload.params = err.params;
    }
    if (err.conflicts?.length) {
      payload.conflicts = err.conflicts;
    }
    if (err.blockingTasks?.length) {
      payload.blockingTasks = err.blockingTasks;
    }
    return {
      statusCode: err.statusCode || 500,
      payload,
    };
  }

  const statusCode = err?.statusCode || err?.status;
  if (err instanceof ServiceError || statusCode) {
    return {
      statusCode: statusCode || 500,
      payload: {
        message: err.message || 'Internal server error',
        ...(err.errorCode ? { errorCode: err.errorCode } : {}),
        ...(err.params && Object.keys(err.params).length ? { params: err.params } : {}),
      },
    };
  }

  return {
    statusCode: 500,
    payload: {
      message: err?.message || 'Internal server error',
      errorCode: CODES.INTERNAL_ERROR,
    },
  };
};

const sendApiError = (res, err) => {
  const { statusCode, payload } = formatApiError(err);
  return res.status(statusCode).json(payload);
};

module.exports = {
  formatApiError,
  sendApiError,
};

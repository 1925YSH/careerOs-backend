const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Global API Error Handling Middleware
 * Enforces unified error envelope:
 * {
 *   success: false,
 *   error: {
 *     category: string,
 *     message: string,
 *     details?: any
 *   },
 *   requestId: string
 * }
 */
function errorHandler(err, req, res, next) {
  const correlationId = req.id || req.headers['x-request-id'] || 'system';

  // Normalize into standard AppError
  let error = err;

  if (err instanceof AppError) {
    error = err;
  } else if (err.name === 'ValidationError') {
    // Mongoose validation error
    const details = err.errors
      ? Object.values(err.errors).map((e) => ({
          field: e.path,
          message: e.message,
        }))
      : [];
    error = new AppError('validation', 'Validation failed on resource fields', 400, details);
  } else if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    error = new AppError('conflict', `A record with this ${field} already exists.`, 409, {
      field,
    });
  } else if (err.name === 'CastError') {
    error = new AppError('validation', `Invalid ID format for ${err.path}`, 400, {
      path: err.path,
      value: err.value,
    });
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    error = new AppError('authentication', 'Invalid or expired session token', 401);
  } else if (!(err instanceof AppError)) {
    // Unhandled system or syntax error
    error = new AppError(
      'internal',
      process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred. Please try again later.'
        : err.message,
      500
    );
  }

  // Differentiate operational client errors (4xx) from critical server errors (5xx)
  if (error.statusCode >= 500) {
    logger.error(error.message, {
      category: error.category,
      statusCode: error.statusCode,
      correlationId,
      path: req.originalUrl,
      method: req.method,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    });
  } else {
    // 4xx errors (e.g. 401 Unauthenticated, 404 Not Found, 400 Validation) are expected client states
    logger.warn(`${error.category.toUpperCase()}: ${error.message}`, {
      category: error.category,
      statusCode: error.statusCode,
      correlationId,
      path: req.originalUrl,
      method: req.method,
    });
  }

  const response = {
    success: false,
    error: {
      category: error.category,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      ...(process.env.NODE_ENV !== 'production' && error.statusCode === 500
        ? { stack: err.stack }
        : {}),
    },
    requestId: correlationId,
  };

  return res.status(error.statusCode || 500).json(response);
}

module.exports = errorHandler;

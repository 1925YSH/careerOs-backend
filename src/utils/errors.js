/**
 * AI CareerOS - Error Taxonomy
 * Based on Architecture Specification (Section 17 - Backend Architecture)
 * Taxonomy: validation, authentication, authorization, not-found, conflict,
 *           rate-limit, upstream-source, ai-provider, storage, internal
 */

class AppError extends Error {
  constructor(category, message, statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.category = category;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Invalid request payload', details = null) {
    super('validation', message, 400, details);
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required or invalid credentials', details = null) {
    super('authentication', message, 401, details);
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Access denied: insufficient permissions or resource ownership failure', details = null) {
    super('authorization', message, 403, details);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details = null) {
    super('not-found', message, 404, details);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists or state conflict detected', details = null) {
    super('conflict', message, 409, details);
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please try again later.', details = null) {
    super('rate-limit', message, 429, details);
  }
}

class UpstreamSourceError extends AppError {
  constructor(message = 'Failed to fetch or interact with upstream career source', details = null) {
    super('upstream-source', message, 502, details);
  }
}

class AIProviderError extends AppError {
  constructor(message = 'AI model service unavailable or extraction error', details = null) {
    super('ai-provider', message, 503, details);
  }
}

class StorageError extends AppError {
  constructor(message = 'Storage or AWS S3 operation failed', details = null) {
    super('storage', message, 500, details);
  }
}

class InternalError extends AppError {
  constructor(message = 'An unexpected internal error occurred', details = null) {
    super('internal', message, 500, details);
    this.isOperational = false;
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  UpstreamSourceError,
  AIProviderError,
  StorageError,
  InternalError,
};


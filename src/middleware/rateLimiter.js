const rateLimit = require('express-rate-limit');
const { RateLimitError } = require('../utils/errors');

/**
 * Standard rate limiter factory returning JSON error envelopes matching error taxonomy
 */
const createLimiter = (options) => {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: options.max || 100,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next) => {
      next(new RateLimitError(options.message || 'Too many requests. Please try again later.'));
    },
    ...options,
  });
};

// General API protection (150 requests per 15 minutes)
const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 150,
  message: 'API rate limit exceeded. Please throttle your requests.',
});

// Authentication rate limiter (brute-force defense: 10 attempts per 15 minutes)
const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'Too many authentication attempts. Please try again after 15 minutes.',
});

// AI endpoints rate limiter (cost & abuse control: 25 requests per hour)
const aiLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 25,
  message: 'AI request limit reached for this hour. Please try again shortly.',
});

// Ingestion triggers rate limiter
const ingestionLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Ingestion trigger rate limit exceeded.',
});

module.exports = {
  apiLimiter,
  authLimiter,
  aiLimiter,
  ingestionLimiter,
};


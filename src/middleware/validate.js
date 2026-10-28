const { ValidationError } = require('../utils/errors');

/**
 * Validates incoming request against a Zod schema
 * @param {import('zod').ZodSchema} schema
 * @param {'body' | 'query' | 'params'} source
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[source]);
      req[source] = parsed; // Replace with sanitized/parsed value
      next();
    } catch (err) {
      const details = err.errors ? err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })) : err.message;
      next(new ValidationError('Request validation failed', details));
    }
  };
};

module.exports = validate;


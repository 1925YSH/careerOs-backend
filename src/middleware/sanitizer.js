/**
 * Security sanitization middleware suite adhering to OWASP ASVS 5.0
 * 1. sanitizeNoSql: Recursively strips keys beginning with '$' or containing '.'
 * 2. sanitizeXss: Strips scripts, iframes, evil handlers, and javascript: protocols from strings
 * 3. hppGuard: Defends against HTTP Parameter Pollution on query strings
 */

/**
 * Deeply strips MongoDB operator keys (keys starting with $ or containing .)
 */
function sanitizeObject(val) {
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeObject);
  }
  const clean = {};
  for (const key of Object.keys(val)) {
    if (key.startsWith('$') || key.includes('.')) {
      continue;
    }
    clean[key] = sanitizeObject(val[key]);
  }
  return clean;
}

function sanitizeNoSql(req, res, next) {
  if (req.body) req.body = sanitizeObject(req.body);
  if (req.query) req.query = sanitizeObject(req.query);
  if (req.params) req.params = sanitizeObject(req.params);
  next();
}

/**
 * Strips script tags, iframes, event handler attributes, and javascript: URIs
 */
function stripXss(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:[^"'\s]*/gi, '')
    .replace(/\bon\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');
}

function sanitizeXssObject(val) {
  if (typeof val === 'string') {
    return stripXss(val);
  }
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeXssObject);
  }
  const clean = {};
  for (const key of Object.keys(val)) {
    clean[key] = sanitizeXssObject(val[key]);
  }
  return clean;
}

function sanitizeXss(req, res, next) {
  if (req.body) {
    req.body = sanitizeXssObject(req.body);
  }
  next();
}

/**
 * HTTP Parameter Pollution guard
 * Keeps the last scalar value when unexpected array parameter is supplied
 */
const ALLOWED_ARRAY_QUERY_PARAMS = [
  'skills',
  'workMode',
  'employmentType',
  'targetRoles',
  'tags',
  'locations',
];

function hppGuard(req, res, next) {
  if (req.query && typeof req.query === 'object') {
    for (const [key, value] of Object.entries(req.query)) {
      if (Array.isArray(value) && !ALLOWED_ARRAY_QUERY_PARAMS.includes(key)) {
        req.query[key] = value[value.length - 1];
      }
    }
  }
  next();
}

module.exports = {
  sanitizeNoSql,
  sanitizeXss,
  hppGuard,
};

const { v4: uuidv4 } = require('uuid');

/**
 * Attaches a unique correlation/request ID to each incoming HTTP request
 * and sets it in the response header for end-to-end observability.
 */
function requestId(req, res, next) {
  const incomingId = req.headers['x-request-id'];
  const currentId = incomingId || uuidv4();
  req.id = currentId;
  res.setHeader('X-Request-Id', currentId);
  next();
}

module.exports = requestId;


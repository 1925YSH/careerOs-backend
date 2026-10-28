const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AuthenticationError, AuthorizationError } = require('../utils/errors');
const User = require('../models/User');

/**
 * Verifies JWT session token from HttpOnly cookie or Authorization Bearer header
 */
const authenticate = async (req, res, next) => {
  try {
    let token = null;

    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(new AuthenticationError('Authentication required. Please sign in.'));
    }

    const decoded = jwt.verify(token, env.JWT_SECRET);

    // Fetch user from DB to confirm status is active
    const user = await User.findById(decoded.id).select('-passwordHash');
    if (!user) {
      return next(new AuthenticationError('User belonging to this token no longer exists.'));
    }

    if (user.status !== 'active') {
      return next(new AuthorizationError('Your account has been suspended or deactivated.'));
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return next(new AuthenticationError('Session expired. Please sign in again.'));
    }
    return next(new AuthenticationError('Invalid session token.'));
  }
};

/**
 * Optional authentication middleware for public endpoints that have personalized enhancements
 * (e.g., job search returns match scores if user is logged in, but works publicly if not)
 */
const optionalAuthenticate = async (req, res, next) => {
  try {
    let token = null;
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      const decoded = jwt.verify(token, env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-passwordHash');
      if (user && user.status === 'active') {
        req.user = user;
      }
    }
  } catch (err) {
    // Silently continue without user attached
  }
  next();
};

/**
 * Role-Based Access Control (RBAC) Guard
 * Ensures only authorized roles can access the endpoint
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required.'));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        new AuthorizationError(`Access denied. Requires one of the following roles: ${roles.join(', ')}`)
      );
    }
    next();
  };
};

/**
 * Resource Ownership Verification Helper
 * Prevents Insecure Direct Object References (IDOR / BOLA)
 */
const requireOwnershipOrAdmin = (getOwnerIdFn) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required.'));
    }
    if (req.user.role === 'admin') {
      return next(); // Admins bypass ownership check
    }

    const ownerId = getOwnerIdFn(req);
    if (!ownerId || ownerId.toString() !== req.user._id.toString()) {
      return next(new AuthorizationError('You do not have permission to modify this resource.'));
    }
    next();
  };
};

module.exports = {
  authenticate,
  optionalAuthenticate,
  requireRole,
  requireOwnershipOrAdmin,
};


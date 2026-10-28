const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const Company = require('../models/Company');
const AuditLog = require('../models/AuditLog');
const env = require('../config/env');
const { ConflictError, AuthenticationError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class AuthService {
  /**
   * Generates JWT signed token for the user
   */
  generateToken(user) {
    return jwt.sign(
      {
        id: user._id,
        role: user.role,
        email: user.email,
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    );
  }

  /**
   * Register a new user (Candidate or Company)
   */
  async register(data, reqMeta = {}) {
    const { email, password, role, name, companyName, domain, website } = data;

    // Strict security rule: Admin cannot be self-selected
    if (role === 'admin') {
      throw new ValidationError('Administrative accounts cannot be self-registered.');
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new ConflictError('An account with this email already exists.');
    }

    // Hash password with bcrypt cost factor 12
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await User.create({
      email,
      passwordHash,
      role,
      status: role === 'company' ? 'pending_verification' : 'active',
    });

    // Create corresponding domain entity
    if (role === 'candidate') {
      await CandidateProfile.create({
        userId: user._id,
        name: name || email.split('@')[0],
      });
    } else if (role === 'company') {
      const companyDomain = domain || email.split('@')[1];
      await Company.create({
        ownerUserId: user._id,
        name: companyName || email.split('@')[0],
        domain: companyDomain,
        careersUrl: website || `https://${companyDomain}`,
        verified: false,
        status: 'pending_review',
      });
    }

    // Record audit log
    await AuditLog.create({
      actorId: user._id,
      actorRole: role,
      action: 'USER_REGISTERED',
      targetType: 'user',
      targetId: user._id,
      metadata: { role, email: user.email },
      ipAddress: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    const token = this.generateToken(user);
    return { user, token };
  }

  /**
   * Login user with email and password
   */
  async login(email, password, reqMeta = {}) {
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user) {
      // Mitigate timing attacks by performing a dummy hash comparison
      await bcrypt.compare(password, '$2a$12$e80M5YQ7h5F6.Q8r1t0kXeU4k.2B5p2W4zK9t1Z1l0l2a3b4c5d6e');
      throw new AuthenticationError('Invalid email or password.');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new AuthenticationError('Invalid email or password.');
    }

    if (user.status === 'suspended') {
      throw new AuthenticationError('Your account has been suspended. Please contact support.');
    }

    // Log successful login audit
    await AuditLog.create({
      actorId: user._id,
      actorRole: user.role,
      action: 'USER_LOGIN',
      targetType: 'user',
      targetId: user._id,
      ipAddress: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    const token = this.generateToken(user);
    return { user, token };
  }

  /**
   * Fetch current authenticated user's profile
   */
  async getMe(userId, role) {
    const user = await User.findById(userId);
    if (!user) {
      throw new AuthenticationError('User not found.');
    }

    let profile = null;
    if (role === 'candidate') {
      profile = await CandidateProfile.findOne({ userId });
    } else if (role === 'company') {
      profile = await Company.findOne({ ownerUserId: userId });
    }

    return { user, profile };
  }
}

module.exports = new AuthService();


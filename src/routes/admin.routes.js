const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const User = require('../models/User');
const Company = require('../models/Company');
const Job = require('../models/Job');
const JobSource = require('../models/JobSource');
const IngestionRun = require('../models/IngestionRun');
const AuditLog = require('../models/AuditLog');
const { ingestionLimiter } = require('../middleware/rateLimiter');
const { ValidationError } = require('../utils/errors');

const router = express.Router();

// Strict RBAC: All endpoints under /api/admin require authenticated admin session
router.use(authenticate, requireRole('admin'));

/**
 * GET /api/admin/overview - Admin dashboard metrics
 */
router.get('/overview', async (req, res, next) => {
  try {
    const [userCount, companyCount, jobCount, activeSourcesCount, failedRuns] = await Promise.all([
      User.countDocuments(),
      Company.countDocuments(),
      Job.countDocuments({ status: 'active' }),
      JobSource.countDocuments({ active: true }),
      IngestionRun.countDocuments({ status: 'failed' }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        stats: {
          users: userCount,
          companies: companyCount,
          activeJobs: jobCount,
          activeSources: activeSourcesCount,
          failedIngestionRuns: failedRuns,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/users - User management
 */
router.get('/users', async (req, res, next) => {
  try {
    const users = await User.find().select('-passwordHash').sort({ createdAt: -1 }).limit(50);
    return res.status(200).json({ success: true, data: { users } });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/companies - Company management
 */
router.get('/companies', async (req, res, next) => {
  try {
    const companies = await Company.find().populate('ownerUserId', 'email').sort({ createdAt: -1 }).limit(50);
    return res.status(200).json({ success: true, data: { companies } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/job-sources - Register a verified crawl source
 */
router.post('/job-sources', async (req, res, next) => {
  try {
    const { companyId, careersUrl, allowedDomains, parserStrategy, crawlIntervalHours } = req.body;

    // Security rule: Strict domain allowlist to mitigate SSRF
    if (!allowedDomains || !Array.isArray(allowedDomains) || allowedDomains.length === 0) {
      throw new ValidationError('At least one allowed domain must be specified for SSRF defense.');
    }

    const source = await JobSource.create({
      companyId,
      careersUrl,
      allowedDomains,
      parserStrategy: parserStrategy || 'generic_html',
      crawlIntervalHours: crawlIntervalHours || 24,
      permissionStatus: 'approved',
      active: true,
    });

    return res.status(201).json({ success: true, data: { source } });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/ingestion/runs - Ingestion run logs
 */
router.get('/ingestion/runs', async (req, res, next) => {
  try {
    const runs = await IngestionRun.find()
      .populate('sourceId', 'careersUrl allowedDomains')
      .sort({ startedAt: -1 })
      .limit(50);

    return res.status(200).json({ success: true, data: { runs } });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/audit-logs - Security and operational audit trail
 */
router.get('/audit-logs', async (req, res, next) => {
  try {
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100);
    return res.status(200).json({ success: true, data: { logs } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;


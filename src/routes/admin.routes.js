const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const User = require('../models/User');
const Company = require('../models/Company');
const Job = require('../models/Job');
const JobSource = require('../models/JobSource');
const IngestionRun = require('../models/IngestionRun');
const AuditLog = require('../models/AuditLog');
const { validateSafeUrl } = require('../utils/ssrf');
const { triggerIngestionNow, runAllActiveSources } = require('../ingestion/scheduler');
const { ValidationError, NotFoundError } = require('../utils/errors');

const router = express.Router();

// Strict RBAC: All endpoints under /api/admin require authenticated admin session
router.use(authenticate, requireRole('admin'));

/**
 * GET /api/admin/overview - Admin dashboard metrics & pipeline health
 */
router.get('/overview', async (req, res, next) => {
  try {
    const [userCount, companyCount, jobCount, activeSourcesCount, failedRuns, ingestedJobsCount, recentRuns] =
      await Promise.all([
        User.countDocuments(),
        Company.countDocuments(),
        Job.countDocuments({ status: 'active' }),
        JobSource.countDocuments({ active: true }),
        IngestionRun.countDocuments({ status: 'failed' }),
        Job.countDocuments({ sourceType: 'ingested' }),
        IngestionRun.find()
          .populate({
            path: 'sourceId',
            select: 'careersUrl companyId',
            populate: { path: 'companyId', select: 'name domain' },
          })
          .sort({ startedAt: -1 })
          .limit(5),
      ]);

    return res.status(200).json({
      success: true,
      data: {
        stats: {
          users: userCount,
          companies: companyCount,
          activeJobs: jobCount,
          ingestedJobs: ingestedJobsCount,
          activeSources: activeSourcesCount,
          failedIngestionRuns: failedRuns,
        },
        recentRuns,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// SOURCE REGISTRY ENDPOINTS
// ==========================================

const handleGetSources = async (req, res, next) => {
  try {
    const { active, search } = req.query;
    const filter = {};
    if (active !== undefined) {
      filter.active = active === 'true';
    }

    const sources = await JobSource.find(filter)
      .populate('companyId', 'name domain logo verified')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: { sources },
    });
  } catch (error) {
    next(error);
  }
};

const handleCreateSource = async (req, res, next) => {
  try {
    const { companyId, careersUrl, allowedDomains, parserStrategy, crawlIntervalHours } = req.body;

    if (!careersUrl) {
      throw new ValidationError('Careers URL is required');
    }

    // SSRF verification
    const ssrfCheck = await validateSafeUrl(careersUrl);
    if (!ssrfCheck.isValid) {
      throw new ValidationError(`SSRF Security check failed: ${ssrfCheck.error}`);
    }

    // Strict domain allowlist to mitigate SSRF
    if (!allowedDomains || !Array.isArray(allowedDomains) || allowedDomains.length === 0) {
      throw new ValidationError('At least one allowed domain must be specified for SSRF defense.');
    }

    // Verify company exists
    const company = await Company.findById(companyId);
    if (!company) {
      throw new ValidationError('Referenced company does not exist.');
    }

    const source = await JobSource.create({
      companyId,
      careersUrl,
      allowedDomains: allowedDomains.map((d) => d.toLowerCase().trim()),
      parserStrategy: parserStrategy || 'generic_html',
      crawlIntervalHours: crawlIntervalHours || 24,
      permissionStatus: 'approved',
      active: true,
    });

    await AuditLog.create({
      actorId: req.user._id,
      actorRole: 'admin',
      action: 'source_create',
      targetType: 'jobSource',
      targetId: source._id,
      metadata: { careersUrl, allowedDomains },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({ success: true, data: { source } });
  } catch (error) {
    next(error);
  }
};

router.get('/sources', handleGetSources);
router.get('/job-sources', handleGetSources);

router.post('/sources', handleCreateSource);
router.post('/job-sources', handleCreateSource);

const handlePatchSource = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { active, crawlIntervalHours, parserStrategy, permissionStatus, allowedDomains } = req.body;

    const source = await JobSource.findById(id);
    if (!source) {
      throw new NotFoundError('Job source not found');
    }

    if (active !== undefined) source.active = active;
    if (crawlIntervalHours !== undefined) source.crawlIntervalHours = crawlIntervalHours;
    if (parserStrategy !== undefined) source.parserStrategy = parserStrategy;
    if (permissionStatus !== undefined) source.permissionStatus = permissionStatus;
    if (allowedDomains !== undefined && Array.isArray(allowedDomains)) {
      source.allowedDomains = allowedDomains.map((d) => d.toLowerCase().trim());
    }

    await source.save();

    await AuditLog.create({
      actorId: req.user._id,
      actorRole: 'admin',
      action: 'source_update',
      targetType: 'jobSource',
      targetId: source._id,
      metadata: req.body,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({ success: true, data: { source } });
  } catch (error) {
    next(error);
  }
};

router.patch('/sources/:id', handlePatchSource);
router.patch('/job-sources/:id', handlePatchSource);

const handleDeleteSource = async (req, res, next) => {
  try {
    const { id } = req.params;
    const source = await JobSource.findByIdAndDelete(id);
    if (!source) {
      throw new NotFoundError('Job source not found');
    }

    await AuditLog.create({
      actorId: req.user._id,
      actorRole: 'admin',
      action: 'source_delete',
      targetType: 'jobSource',
      targetId: source._id,
      metadata: { careersUrl: source.careersUrl },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({ success: true, message: 'Source deleted successfully' });
  } catch (error) {
    next(error);
  }
};

router.delete('/sources/:id', handleDeleteSource);
router.delete('/job-sources/:id', handleDeleteSource);

const handleTriggerRun = async (req, res, next) => {
  try {
    const { id } = req.params;
    const run = await triggerIngestionNow(id);

    return res.status(200).json({
      success: true,
      message: 'Ingestion run completed',
      data: { run },
    });
  } catch (error) {
    next(error);
  }
};

router.post('/sources/:id/run', handleTriggerRun);
router.post('/job-sources/:id/run', handleTriggerRun);

router.post('/ingestion/run-all', async (req, res, next) => {
  try {
    const results = await runAllActiveSources();
    return res.status(200).json({
      success: true,
      message: `Triggered ingestion across active sources`,
      data: { results },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// INGESTION RUNS ENDPOINTS
// ==========================================

router.get('/ingestion/runs', async (req, res, next) => {
  try {
    const { status, limit = 50, page = 1 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [runs, total] = await Promise.all([
      IngestionRun.find(filter)
        .populate({
          path: 'sourceId',
          select: 'careersUrl allowedDomains companyId',
          populate: { path: 'companyId', select: 'name domain' },
        })
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10)),
      IngestionRun.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        runs,
        total,
        page: parseInt(page, 10),
        pages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/ingestion/runs/:id', async (req, res, next) => {
  try {
    const run = await IngestionRun.findById(req.params.id).populate({
      path: 'sourceId',
      populate: { path: 'companyId', select: 'name domain' },
    });

    if (!run) {
      throw new NotFoundError('Ingestion run not found');
    }

    return res.status(200).json({ success: true, data: { run } });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// JOB MODERATION ENDPOINTS
// ==========================================

router.get('/jobs', async (req, res, next) => {
  try {
    const { status, sourceType, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (sourceType) filter.sourceType = sourceType;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [jobs, total] = await Promise.all([
      Job.find(filter)
        .populate('companyId', 'name domain logo verified')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10)),
      Job.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        jobs,
        total,
        page: parseInt(page, 10),
        pages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/jobs/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!['active', 'flagged', 'archived', 'draft'].includes(status)) {
      throw new ValidationError('Invalid status value.');
    }

    const job = await Job.findById(id);
    if (!job) {
      throw new NotFoundError('Job not found');
    }

    const oldStatus = job.status;
    job.status = status;
    await job.save();

    await AuditLog.create({
      actorId: req.user._id,
      actorRole: 'admin',
      action: 'job_moderate_status',
      targetType: 'job',
      targetId: job._id,
      metadata: { oldStatus, newStatus: status, reason },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: `Job status updated to '${status}'`,
      data: { job },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// USER & COMPANY MANAGEMENT
// ==========================================

router.get('/users', async (req, res, next) => {
  try {
    const users = await User.find().select('-passwordHash').sort({ createdAt: -1 }).limit(50);
    return res.status(200).json({ success: true, data: { users } });
  } catch (error) {
    next(error);
  }
});

router.patch('/users/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
      throw new ValidationError("Status must be 'active' or 'suspended'");
    }

    const user = await User.findById(req.params.id).select('-passwordHash');
    if (!user) throw new NotFoundError('User not found');

    user.status = status;
    await user.save();

    await AuditLog.create({
      actorId: req.user._id,
      actorRole: 'admin',
      action: 'user_status_change',
      targetType: 'user',
      targetId: user._id,
      metadata: { status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({ success: true, data: { user } });
  } catch (error) {
    next(error);
  }
});

router.get('/companies', async (req, res, next) => {
  try {
    const companies = await Company.find()
      .populate('ownerUserId', 'email')
      .sort({ createdAt: -1 })
      .limit(50);
    return res.status(200).json({ success: true, data: { companies } });
  } catch (error) {
    next(error);
  }
});

router.patch('/companies/:id/status', async (req, res, next) => {
  try {
    const { status, verified } = req.body;
    const company = await Company.findById(req.params.id);
    if (!company) throw new NotFoundError('Company not found');

    if (status !== undefined) company.status = status;
    if (verified !== undefined) company.verified = verified;
    await company.save();

    await AuditLog.create({
      actorId: req.user._id,
      actorRole: 'admin',
      action: 'company_status_change',
      targetType: 'company',
      targetId: company._id,
      metadata: { status, verified },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({ success: true, data: { company } });
  } catch (error) {
    next(error);
  }
});

router.get('/audit-logs', async (req, res, next) => {
  try {
    const { action, targetType, limit = 100 } = req.query;
    const filter = {};
    if (action) filter.action = action;
    if (targetType) filter.targetType = targetType;

    const logs = await AuditLog.find(filter)
      .populate('actorId', 'email role')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10));

    return res.status(200).json({ success: true, data: { logs } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

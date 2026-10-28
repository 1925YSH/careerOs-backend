const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { authenticate, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const Company = require('../models/Company');
const Job = require('../models/Job');
const JobSource = require('../models/JobSource');
const Application = require('../models/Application');
const { NotFoundError, AuthorizationError, ValidationError, ConflictError } = require('../utils/errors');
const { validateSafeUrl } = require('../utils/ssrf');
const {
  createOrUpdateProfileSchema,
  createJobSchema,
  updateJobSchema,
  updateApplicantStatusSchema,
  submitSourceSchema,
} = require('../validation/company.validation');

const router = express.Router();

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

function sanitizeText(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').trim();
}

// ==========================================
// 1. PUBLIC DIRECTORY & DETAIL ENDPOINTS
// ==========================================

/**
 * GET /api/companies - Public Company Directory
 */
router.get('/', async (req, res, next) => {
  try {
    const { search, industry, location, page = 1, limit = 20 } = req.query;
    const query = { status: 'active' };

    if (search && search.trim()) {
      query.name = { $regex: escapeRegex(search.trim()), $options: 'i' };
    }
    if (industry && industry.trim()) {
      query.industry = { $regex: escapeRegex(industry.trim()), $options: 'i' };
    }
    if (location && location.trim()) {
      query.location = { $regex: escapeRegex(location.trim()), $options: 'i' };
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [companies, total] = await Promise.all([
      Company.find(query).sort({ verified: -1, name: 1 }).skip(skip).limit(limitNum).lean(),
      Company.countDocuments(query),
    ]);

    const companyIds = companies.map((c) => c._id);
    const jobCounts = await Job.aggregate([
      { $match: { companyId: { $in: companyIds }, status: 'active' } },
      { $group: { _id: '$companyId', count: { $sum: 1 } } },
    ]);
    const jobCountMap = {};
    jobCounts.forEach((jc) => {
      jobCountMap[jc._id.toString()] = jc.count;
    });

    const enrichedCompanies = companies.map((c) => ({
      ...c,
      openJobCount: jobCountMap[c._id.toString()] || 0,
    }));

    return res.status(200).json({
      success: true,
      data: {
        companies: enrichedCompanies,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/companies/:id - Public Company Detail with Open Roles
 */
router.get('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new NotFoundError('Invalid company ID');
    }

    const company = await Company.findById(req.params.id).lean();
    if (!company) {
      throw new NotFoundError('Company not found');
    }

    const jobs = await Job.find({ companyId: company._id, status: 'active' })
      .sort({ postedAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        company,
        jobs,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 2. COMPANY WORKSPACE: PROFILE & ONBOARDING
// ==========================================

/**
 * Helper: Find authenticated user's company profile
 */
async function getCompanyForUser(userId) {
  return await Company.findOne({ ownerUserId: userId });
}

/**
 * GET /api/companies/workspace/profile - Fetch logged-in employer's company profile
 */
router.get('/workspace/profile', authenticate, requireRole('company'), async (req, res, next) => {
  try {
    const company = await getCompanyForUser(req.user._id);
    return res.status(200).json({
      success: true,
      data: {
        company: company || null,
        hasConfiguredProfile: !!company,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/companies/workspace/profile - Create or update company profile
 */
router.post(
  '/workspace/profile',
  authenticate,
  requireRole('company'),
  validate(createOrUpdateProfileSchema),
  async (req, res, next) => {
    try {
      const { name, domain, careersUrl, logoUrl, description, industry, location, size } = req.body;

      const normalizedDomain = domain.toLowerCase().trim();

      // Check if domain is already claimed by another user's company
      const existingDomain = await Company.findOne({
        domain: normalizedDomain,
        ownerUserId: { $ne: req.user._id },
      });

      if (existingDomain) {
        throw new ConflictError('A company with this domain name is already registered.');
      }

      let company = await getCompanyForUser(req.user._id);

      if (company) {
        // Update existing profile
        company.name = sanitizeText(name);
        company.domain = normalizedDomain;
        if (careersUrl !== undefined) company.careersUrl = careersUrl;
        if (logoUrl !== undefined) company.logoUrl = logoUrl;
        if (description !== undefined) company.description = sanitizeText(description);
        if (industry !== undefined) company.industry = sanitizeText(industry);
        if (location !== undefined) company.location = sanitizeText(location);
        if (size !== undefined) company.size = size;
        await company.save();
      } else {
        // Create new company record
        company = await Company.create({
          ownerUserId: req.user._id,
          name: sanitizeText(name),
          domain: normalizedDomain,
          careersUrl: careersUrl || '',
          logoUrl: logoUrl || '',
          description: sanitizeText(description || ''),
          industry: sanitizeText(industry || ''),
          location: sanitizeText(location || ''),
          size: size || '11-50',
          status: 'active', // Company direct posting active
          verified: false,
        });
      }

      return res.status(200).json({
        success: true,
        data: { company },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// 3. COMPANY WORKSPACE: DASHBOARD & METRICS
// ==========================================

/**
 * GET /api/companies/workspace/dashboard - Workspace KPI summary
 */
router.get('/workspace/dashboard', authenticate, requireRole('company'), async (req, res, next) => {
  try {
    const company = await getCompanyForUser(req.user._id);
    if (!company) {
      return res.status(200).json({
        success: true,
        data: {
          needsProfileSetup: true,
          stats: {
            activeJobs: 0,
            totalJobs: 0,
            syncedJobs: 0,
            totalApplicants: 0,
          },
          source: null,
          recentJobs: [],
          recentApplicants: [],
        },
      });
    }

    const [activeJobs, totalJobs, syncedJobs, totalApplicants, source, recentJobs, recentApplicants] =
      await Promise.all([
        Job.countDocuments({ companyId: company._id, status: 'active' }),
        Job.countDocuments({ companyId: company._id }),
        Job.countDocuments({ companyId: company._id, sourceType: 'ingested' }),
        Application.countDocuments({ companyId: company._id }),
        JobSource.findOne({ companyId: company._id }),
        Job.find({ companyId: company._id }).sort({ createdAt: -1 }).limit(5).lean(),
        Application.find({ companyId: company._id })
          .populate('candidateId', 'email name')
          .populate('jobId', 'title')
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
      ]);

    return res.status(200).json({
      success: true,
      data: {
        needsProfileSetup: false,
        company,
        stats: {
          activeJobs,
          totalJobs,
          syncedJobs,
          totalApplicants,
        },
        source: source || null,
        recentJobs,
        recentApplicants,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 4. COMPANY WORKSPACE: JOBS CRUD (BOLA SAFE)
// ==========================================

/**
 * GET /api/companies/workspace/jobs - List company's jobs with filters
 */
router.get('/workspace/jobs', authenticate, requireRole('company'), async (req, res, next) => {
  try {
    const company = await getCompanyForUser(req.user._id);
    if (!company) {
      throw new AuthorizationError('Please complete your company profile first.');
    }

    const { status, search, page = 1, limit = 20 } = req.query;
    const query = { companyId: company._id };

    if (status && status !== 'all') {
      query.status = status;
    }
    if (search && search.trim()) {
      query.title = { $regex: escapeRegex(search.trim()), $options: 'i' };
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [jobs, total] = await Promise.all([
      Job.find(query).sort({ postedAt: -1 }).skip(skip).limit(limitNum).lean(),
      Job.countDocuments(query),
    ]);

    // Attach applicant count to each job
    const jobIds = jobs.map((j) => j._id);
    const appCounts = await Application.aggregate([
      { $match: { jobId: { $in: jobIds } } },
      { $group: { _id: '$jobId', count: { $sum: 1 } } },
    ]);
    const appCountMap = {};
    appCounts.forEach((ac) => {
      appCountMap[ac._id.toString()] = ac.count;
    });

    const enrichedJobs = jobs.map((job) => ({
      ...job,
      applicantCount: appCountMap[job._id.toString()] || 0,
    }));

    return res.status(200).json({
      success: true,
      data: {
        jobs: enrichedJobs,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/companies/workspace/jobs - Create a new job listing
 */
router.post(
  '/workspace/jobs',
  authenticate,
  requireRole('company'),
  validate(createJobSchema),
  async (req, res, next) => {
    try {
      const company = await getCompanyForUser(req.user._id);
      if (!company) {
        throw new AuthorizationError('You must configure a company profile before posting jobs.');
      }

      const {
        title,
        description,
        location,
        workMode,
        employmentType,
        skills,
        experienceMin,
        experienceMax,
        salary,
        applicationUrl,
        status = 'active',
      } = req.body;

      // Deterministic fingerprint for the direct job
      const rawPayload = `${company._id}:${title.toLowerCase()}:${location.toLowerCase()}:${Date.now()}`;
      const fingerprint = crypto.createHash('sha256').update(rawPayload).digest('hex');

      const job = await Job.create({
        companyId: company._id,
        sourceType: 'company_posted',
        title: sanitizeText(title),
        description: sanitizeText(description),
        location: sanitizeText(location),
        workMode,
        employmentType,
        skills: skills.map((s) => s.toLowerCase().trim()),
        experienceMin,
        experienceMax,
        salary,
        status,
        fingerprint,
        applicationUrl: applicationUrl || `${process.env.CLIENT_URL || 'http://localhost:3000'}/jobs`,
        sourceAttribution: {
          domain: company.domain,
          verifiedSource: company.verified,
          lastCheckedAt: new Date(),
        },
        postedAt: new Date(),
      });

      return res.status(201).json({
        success: true,
        data: { job },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/companies/workspace/jobs/:id - Edit job (Strict BOLA/IDOR protection)
 */
router.patch(
  '/workspace/jobs/:id',
  authenticate,
  requireRole('company'),
  validate(updateJobSchema),
  async (req, res, next) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        throw new NotFoundError('Invalid job ID format');
      }

      const company = await getCompanyForUser(req.user._id);
      if (!company) {
        throw new AuthorizationError('Company profile not found.');
      }

      // Ensure the job exists AND belongs strictly to this company
      const job = await Job.findOne({ _id: req.params.id, companyId: company._id });
      if (!job) {
        throw new NotFoundError('Job listing not found or access denied');
      }

      const updateFields = { ...req.body };
      if (updateFields.title) updateFields.title = sanitizeText(updateFields.title);
      if (updateFields.description) updateFields.description = sanitizeText(updateFields.description);
      if (updateFields.location) updateFields.location = sanitizeText(updateFields.location);
      if (updateFields.skills) updateFields.skills = updateFields.skills.map((s) => s.toLowerCase().trim());

      Object.assign(job, updateFields);
      await job.save();

      return res.status(200).json({
        success: true,
        data: { job },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/companies/workspace/jobs/:id - Archive/Delete job (Strict BOLA/IDOR)
 */
router.delete('/workspace/jobs/:id', authenticate, requireRole('company'), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new NotFoundError('Invalid job ID format');
    }

    const company = await getCompanyForUser(req.user._id);
    if (!company) {
      throw new AuthorizationError('Company profile not found.');
    }

    const job = await Job.findOne({ _id: req.params.id, companyId: company._id });
    if (!job) {
      throw new NotFoundError('Job listing not found or access denied');
    }

    // Set to archived rather than physical delete to preserve application history
    job.status = 'archived';
    await job.save();

    return res.status(200).json({
      success: true,
      message: 'Job listing archived successfully',
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 5. CAREER SOURCE / SSRF GUARDED INGESTION
// ==========================================

/**
 * GET /api/companies/workspace/source - Get current source ingestion status
 */
router.get('/workspace/source', authenticate, requireRole('company'), async (req, res, next) => {
  try {
    const company = await getCompanyForUser(req.user._id);
    if (!company) {
      throw new AuthorizationError('Company profile not found.');
    }

    const source = await JobSource.findOne({ companyId: company._id });
    return res.status(200).json({
      success: true,
      data: { source: source || null },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/companies/workspace/source - Connect official careers portal URL (SSRF Protected)
 */
router.post(
  '/workspace/source',
  authenticate,
  requireRole('company'),
  validate(submitSourceSchema),
  async (req, res, next) => {
    try {
      const company = await getCompanyForUser(req.user._id);
      if (!company) {
        throw new AuthorizationError('Company profile not found.');
      }

      const { careersUrl } = req.body;

      // SSRF & DNS Rebinding validation
      const ssrfCheck = await validateSafeUrl(careersUrl);
      if (!ssrfCheck.isValid) {
        throw new ValidationError(`Security rejection: ${ssrfCheck.error}`);
      }

      const hostname = ssrfCheck.parsedUrl.hostname.toLowerCase();

      // Upsert JobSource
      let source = await JobSource.findOne({ companyId: company._id });
      if (source) {
        source.careersUrl = careersUrl;
        if (!source.allowedDomains.includes(hostname)) {
          source.allowedDomains.push(hostname);
        }
        source.permissionStatus = 'approved';
        source.active = true;
        await source.save();
      } else {
        source = await JobSource.create({
          companyId: company._id,
          careersUrl,
          allowedDomains: [hostname],
          permissionStatus: 'approved',
          active: true,
          crawlIntervalHours: 24,
        });
      }

      // Update careersUrl on company
      company.careersUrl = careersUrl;
      await company.save();

      return res.status(200).json({
        success: true,
        data: { source },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// 6. APPLICANT PIPELINE (BOLA SAFE)
// ==========================================

/**
 * GET /api/companies/workspace/applicants - View applicant pipeline
 */
router.get('/workspace/applicants', authenticate, requireRole('company'), async (req, res, next) => {
  try {
    const company = await getCompanyForUser(req.user._id);
    if (!company) {
      throw new AuthorizationError('Company profile not found.');
    }

    const { jobId, status, page = 1, limit = 20 } = req.query;
    const query = { companyId: company._id };

    if (jobId && mongoose.Types.ObjectId.isValid(jobId)) {
      query.jobId = jobId;
    }
    if (status && status !== 'all') {
      query.status = status;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [applicants, total] = await Promise.all([
      Application.find(query)
        .populate('candidateId', 'email name')
        .populate('jobId', 'title location workMode')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Application.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        applicants,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/companies/workspace/applicants/:id/status - Update applicant review stage
 */
router.patch(
  '/workspace/applicants/:id/status',
  authenticate,
  requireRole('company'),
  validate(updateApplicantStatusSchema),
  async (req, res, next) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        throw new NotFoundError('Invalid application ID format');
      }

      const company = await getCompanyForUser(req.user._id);
      if (!company) {
        throw new AuthorizationError('Company profile not found.');
      }

      // Strict BOLA: ensure this application belongs to this company's job
      const application = await Application.findOne({
        _id: req.params.id,
        companyId: company._id,
      });

      if (!application) {
        throw new NotFoundError('Application not found or unauthorized');
      }

      const { status, note } = req.body;
      application.status = status;
      application.history.push({
        status,
        note: note || `Application moved to ${status} stage by employer`,
        updatedAt: new Date(),
      });

      await application.save();

      return res.status(200).json({
        success: true,
        data: { application },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// 7. HIRING ANALYTICS
// ==========================================

/**
 * GET /api/companies/workspace/analytics - Hiring & pipeline visibility
 */
router.get('/workspace/analytics', authenticate, requireRole('company'), async (req, res, next) => {
  try {
    const company = await getCompanyForUser(req.user._id);
    if (!company) {
      throw new AuthorizationError('Company profile not found.');
    }

    const [workModeBreakdown, applicantStageBreakdown, topSkillsAgg] = await Promise.all([
      Job.aggregate([
        { $match: { companyId: company._id } },
        { $group: { _id: '$workMode', count: { $sum: 1 } } },
      ]),
      Application.aggregate([
        { $match: { companyId: company._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Job.aggregate([
        { $match: { companyId: company._id } },
        { $unwind: '$skills' },
        { $group: { _id: '$skills', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        workModeBreakdown,
        applicantStageBreakdown,
        topSkills: topSkillsAgg.map((s) => ({ skill: s._id, count: s.count })),
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

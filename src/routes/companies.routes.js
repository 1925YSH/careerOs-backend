const express = require('express');
const mongoose = require('mongoose');
const { authenticate, optionalAuthenticate, requireRole } = require('../middleware/auth');
const Company = require('../models/Company');
const Job = require('../models/Job');
const Application = require('../models/Application');
const { NotFoundError, AuthorizationError } = require('../utils/errors');

const router = express.Router();

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

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

    // Attach active job count to each company
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

/**
 * GET /api/companies/me - Get current authenticated company profile
 */
router.get('/me', authenticate, requireRole('company'), async (req, res, next) => {
  try {
    const company = await Company.findOne({ ownerUserId: req.user._id });
    if (!company) {
      throw new NotFoundError('Company profile not found for this account');
    }
    return res.status(200).json({ success: true, data: { company } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/companies/jobs - Create company job
 */
router.post('/jobs', authenticate, requireRole('company'), async (req, res, next) => {
  try {
    const company = await Company.findOne({ ownerUserId: req.user._id });
    if (!company) {
      throw new AuthorizationError('You must configure a company profile before posting jobs.');
    }

    const job = await Job.create({
      ...req.body,
      companyId: company._id,
      sourceType: 'company_posted',
      sourceAttribution: {
        domain: company.domain,
        verifiedSource: company.verified,
        lastCheckedAt: new Date(),
      },
    });

    return res.status(201).json({ success: true, data: { job } });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/companies/jobs/:id - Edit company job
 */
router.patch('/jobs/:id', authenticate, requireRole('company'), async (req, res, next) => {
  try {
    const company = await Company.findOne({ ownerUserId: req.user._id });
    const job = await Job.findOne({ _id: req.params.id, companyId: company._id });

    if (!job) {
      throw new NotFoundError('Job not found or access denied');
    }

    Object.assign(job, req.body);
    await job.save();

    return res.status(200).json({ success: true, data: { job } });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/companies/jobs/:id/applicants - List applicants for job
 */
router.get('/jobs/:id/applicants', authenticate, requireRole('company'), async (req, res, next) => {
  try {
    const company = await Company.findOne({ ownerUserId: req.user._id });
    const job = await Job.findOne({ _id: req.params.id, companyId: company._id });

    if (!job) {
      throw new NotFoundError('Job not found or access denied');
    }

    const applicants = await Application.find({ jobId: job._id })
      .populate('candidateId', 'email')
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, data: { applicants } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

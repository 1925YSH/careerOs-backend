const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const Company = require('../models/Company');
const Job = require('../models/Job');
const Application = require('../models/Application');
const { NotFoundError, AuthorizationError } = require('../utils/errors');

const router = express.Router();

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


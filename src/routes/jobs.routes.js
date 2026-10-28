const express = require('express');
const mongoose = require('mongoose');
const { optionalAuthenticate, authenticate, requireRole } = require('../middleware/auth');
const Job = require('../models/Job');
const Application = require('../models/Application');
const { NotFoundError, ValidationError } = require('../utils/errors');

const router = express.Router();

// Helper to escape regex special characters (NoSQL Injection Defense)
function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

/**
 * GET /api/jobs - Search and filter jobs
 * Query Params: search, location, workMode, employmentType, experienceMin, experienceMax,
 *               minSalary, skills, companyId, sourceType, sort (newest | salary | experience),
 *               page, limit
 */
router.get('/', optionalAuthenticate, async (req, res, next) => {
  try {
    const {
      search,
      location,
      workMode,
      employmentType,
      experienceMin,
      experienceMax,
      minSalary,
      skills,
      companyId,
      sourceType,
      sort = 'newest',
      page = 1,
      limit = 20,
    } = req.query;

    const query = { status: 'active' };

    // 1. Keyword search across title and description
    if (search && search.trim()) {
      const sanitized = escapeRegex(search.trim());
      query.$or = [
        { title: { $regex: sanitized, $options: 'i' } },
        { skills: { $regex: sanitized, $options: 'i' } },
      ];
    }

    // 2. Location filter
    if (location && location.trim()) {
      query.location = { $regex: escapeRegex(location.trim()), $options: 'i' };
    }

    // 3. Work Mode filter (remote, hybrid, on-site)
    if (workMode && workMode !== 'all') {
      const modes = Array.isArray(workMode) ? workMode : workMode.split(',');
      query.workMode = { $in: modes.map((m) => m.trim().toLowerCase()) };
    }

    // 4. Employment Type (FULL_TIME, CONTRACT, INTERNSHIP, PART_TIME)
    if (employmentType && employmentType !== 'all') {
      const types = Array.isArray(employmentType) ? employmentType : employmentType.split(',');
      query.employmentType = { $in: types.map((t) => t.trim().toUpperCase()) };
    }

    // 5. Experience bounds
    if (experienceMin !== undefined && experienceMin !== '') {
      query.experienceMin = { $gte: Number(experienceMin) };
    }
    if (experienceMax !== undefined && experienceMax !== '') {
      query.experienceMin = { ...(query.experienceMin || {}), $lte: Number(experienceMax) };
    }

    // 6. Minimum Salary filter
    if (minSalary && Number(minSalary) > 0) {
      query['salary.max'] = { $gte: Number(minSalary) };
    }

    // 7. Company filter
    if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
      query.companyId = companyId;
    }

    // 8. Source Type filter (company_posted vs ingested)
    if (sourceType && ['company_posted', 'ingested'].includes(sourceType)) {
      query.sourceType = sourceType;
    }

    // 9. Skills Array overlap
    if (skills) {
      const skillList = Array.isArray(skills)
        ? skills
        : skills.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (skillList.length > 0) {
        query.skills = { $in: skillList };
      }
    }

    // Sort order definition
    let sortQuery = { postedAt: -1 };
    if (sort === 'salary') {
      sortQuery = { 'salary.max': -1, postedAt: -1 };
    } else if (sort === 'experience') {
      sortQuery = { experienceMin: 1, postedAt: -1 };
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [jobs, total] = await Promise.all([
      Job.find(query)
        .populate('companyId', 'name domain logoUrl verified industry location')
        .sort(sortQuery)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Job.countDocuments(query),
    ]);

    // If user is candidate, attach saved state for quick UI toggle
    let savedJobIds = new Set();
    if (req.user && req.user.role === 'candidate') {
      const savedApps = await Application.find({
        candidateId: req.user._id,
        status: 'saved',
      }).select('jobId');
      savedJobIds = new Set(savedApps.map((a) => a.jobId.toString()));
    }

    const jobsWithMetadata = jobs.map((job) => ({
      ...job,
      isSaved: savedJobIds.has(job._id.toString()),
    }));

    return res.status(200).json({
      success: true,
      data: {
        jobs: jobsWithMetadata,
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
 * GET /api/jobs/saved/list - Get all saved jobs for current candidate
 */
router.get('/saved/list', authenticate, requireRole('candidate'), async (req, res, next) => {
  try {
    const savedApps = await Application.find({
      candidateId: req.user._id,
      status: 'saved',
    })
      .populate({
        path: 'jobId',
        populate: { path: 'companyId', select: 'name domain logoUrl verified' },
      })
      .sort({ updatedAt: -1 })
      .lean();

    const jobs = savedApps.map((app) => ({
      ...app.jobId,
      applicationId: app._id,
      savedAt: app.updatedAt,
    }));

    return res.status(200).json({
      success: true,
      data: { jobs },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/jobs/:id - Job Detail with Similar Jobs
 */
router.get('/:id', optionalAuthenticate, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new NotFoundError('Invalid job ID format');
    }

    const job = await Job.findById(req.params.id)
      .populate('companyId', 'name domain logoUrl description industry location companySize verified careersUrl')
      .lean();

    if (!job) {
      throw new NotFoundError('Job listing not found or has expired');
    }

    // Find 3-4 similar roles based on shared skills (excluding current job)
    const similarJobs = await Job.find({
      _id: { $ne: job._id },
      status: 'active',
      skills: { $in: job.skills },
    })
      .populate('companyId', 'name domain logoUrl verified')
      .limit(4)
      .select('title location workMode salary skills postedAt')
      .lean();

    let isSaved = false;
    if (req.user && req.user.role === 'candidate') {
      const existing = await Application.findOne({
        candidateId: req.user._id,
        jobId: job._id,
        status: 'saved',
      });
      isSaved = !!existing;
    }

    return res.status(200).json({
      success: true,
      data: {
        job: { ...job, isSaved },
        similarJobs,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/jobs/:id/save - Bookmark / save job
 */
router.post('/:id/save', authenticate, requireRole('candidate'), async (req, res, next) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      throw new NotFoundError('Job not found');
    }

    const application = await Application.findOneAndUpdate(
      { candidateId: req.user._id, jobId: job._id },
      {
        candidateId: req.user._id,
        jobId: job._id,
        companyId: job.companyId,
        status: 'saved',
        notes: req.body.notes || 'Saved for later review',
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Job saved to your shortlist',
      data: { application },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/jobs/:id/save - Remove saved job
 */
router.delete('/:id/save', authenticate, requireRole('candidate'), async (req, res, next) => {
  try {
    await Application.findOneAndDelete({
      candidateId: req.user._id,
      jobId: req.params.id,
      status: 'saved',
    });

    return res.status(200).json({
      success: true,
      message: 'Job removed from your shortlist',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

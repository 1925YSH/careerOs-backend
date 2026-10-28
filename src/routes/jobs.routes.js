const express = require('express');
const { optionalAuthenticate, authenticate, requireRole } = require('../middleware/auth');
const Job = require('../models/Job');
const { NotFoundError } = require('../utils/errors');

const router = express.Router();

/**
 * GET /api/jobs - Search and filter jobs
 */
router.get('/', optionalAuthenticate, async (req, res, next) => {
  try {
    const {
      search,
      location,
      workMode,
      employmentType,
      experienceMin,
      skills,
      page = 1,
      limit = 20,
    } = req.query;

    const query = { status: 'active' };

    if (search) {
      query.$text = { $search: search };
    }
    if (location) {
      query.location = new RegExp(location, 'i');
    }
    if (workMode) {
      query.workMode = workMode;
    }
    if (employmentType) {
      query.employmentType = employmentType;
    }
    if (experienceMin) {
      query.experienceMin = { $lte: Number(experienceMin) };
    }
    if (skills) {
      const skillList = Array.isArray(skills) ? skills : skills.split(',');
      query.skills = { $in: skillList.map((s) => s.trim().toLowerCase()) };
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [jobs, total] = await Promise.all([
      Job.find(query)
        .populate('companyId', 'name domain logoUrl verified')
        .sort({ postedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Job.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        jobs,
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
 * GET /api/jobs/:id - Job Detail
 */
router.get('/:id', optionalAuthenticate, async (req, res, next) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('companyId', 'name domain logoUrl description industry location verified')
      .lean();

    if (!job) {
      throw new NotFoundError('Job listing not found');
    }

    return res.status(200).json({
      success: true,
      data: { job },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;


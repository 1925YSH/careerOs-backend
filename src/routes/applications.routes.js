const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const Application = require('../models/Application');
const { NotFoundError, AuthorizationError } = require('../utils/errors');

const router = express.Router();

// Require candidate role for personal tracking
router.use(authenticate, requireRole('candidate'));

/**
 * GET /api/applications - List candidate's own applications
 */
router.get('/', async (req, res, next) => {
  try {
    const applications = await Application.find({ candidateId: req.user._id })
      .populate('jobId', 'title location workMode companyId')
      .populate('companyId', 'name domain logoUrl verified')
      .sort({ updatedAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: { applications },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/applications - Track application
 */
router.post('/', async (req, res, next) => {
  try {
    const { jobId, companyId, status = 'applied', notes } = req.body;

    const application = await Application.findOneAndUpdate(
      { candidateId: req.user._id, jobId },
      {
        candidateId: req.user._id,
        jobId,
        companyId,
        status,
        notes,
        $push: {
          history: { status, note: notes || 'Application created', updatedAt: new Date() },
        },
      },
      { upsert: true, new: true }
    );

    return res.status(201).json({
      success: true,
      data: { application },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;


const express = require('express');
const mongoose = require('mongoose');
const { authenticate, requireRole } = require('../middleware/auth');
const Application = require('../models/Application');
const Job = require('../models/Job');
const { NotFoundError, ValidationError, AuthorizationError } = require('../utils/errors');

const router = express.Router();

// Require candidate role for personal tracking
router.use(authenticate, requireRole('candidate'));

const ALLOWED_STATUSES = [
  'saved',
  'applied',
  'reviewing',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
];

/**
 * GET /api/applications - List candidate's tracked applications
 */
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = { candidateId: req.user._id };

    if (status && status !== 'all' && ALLOWED_STATUSES.includes(status)) {
      query.status = status;
    }

    const applications = await Application.find(query)
      .populate('jobId', 'title location workMode salary status companyId sourceUrl applicationUrl')
      .populate('companyId', 'name domain logoUrl verified industry')
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
 * POST /api/applications - Track a job application
 */
router.post('/', async (req, res, next) => {
  try {
    const { jobId, status = 'applied', notes } = req.body;

    if (!jobId || !mongoose.Types.ObjectId.isValid(jobId)) {
      throw new ValidationError('A valid jobId is required.');
    }

    if (!ALLOWED_STATUSES.includes(status)) {
      throw new ValidationError(`Invalid status. Must be one of: ${ALLOWED_STATUSES.join(', ')}`);
    }

    const job = await Job.findById(jobId);
    if (!job) {
      throw new NotFoundError('Job listing not found');
    }

    let application = await Application.findOne({
      candidateId: req.user._id,
      jobId: job._id,
    });

    if (application) {
      application.status = status;
      if (notes) application.notes = notes;
      application.history.push({
        status,
        note: notes || `Application moved to ${status}`,
        updatedAt: new Date(),
      });
      await application.save();
    } else {
      application = await Application.create({
        candidateId: req.user._id,
        jobId: job._id,
        companyId: job.companyId,
        status,
        notes: notes || '',
        history: [
          {
            status,
            note: notes || 'Application initiated',
            updatedAt: new Date(),
          },
        ],
      });
    }

    const populatedApp = await Application.findById(application._id)
      .populate('jobId', 'title location workMode salary status')
      .populate('companyId', 'name domain logoUrl verified');

    return res.status(201).json({
      success: true,
      data: { application: populatedApp },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/applications/:id - Update application stage or notes (BOLA/IDOR protected)
 */
router.patch('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new NotFoundError('Invalid application ID format');
    }

    const application = await Application.findOne({
      _id: req.params.id,
      candidateId: req.user._id,
    });

    if (!application) {
      throw new NotFoundError('Application record not found or access denied');
    }

    const { status, notes } = req.body;

    if (status) {
      if (!ALLOWED_STATUSES.includes(status)) {
        throw new ValidationError(`Invalid status. Must be one of: ${ALLOWED_STATUSES.join(', ')}`);
      }
      application.status = status;
      application.history.push({
        status,
        note: notes || `Candidate moved status to ${status}`,
        updatedAt: new Date(),
      });
    }

    if (notes !== undefined) {
      application.notes = notes;
    }

    await application.save();

    const populatedApp = await Application.findById(application._id)
      .populate('jobId', 'title location workMode salary status')
      .populate('companyId', 'name domain logoUrl verified');

    return res.status(200).json({
      success: true,
      data: { application: populatedApp },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/applications/:id - Remove application from tracking (BOLA/IDOR protected)
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new NotFoundError('Invalid application ID format');
    }

    const application = await Application.findOneAndDelete({
      _id: req.params.id,
      candidateId: req.user._id,
    });

    if (!application) {
      throw new NotFoundError('Application record not found or access denied');
    }

    return res.status(200).json({
      success: true,
      message: 'Application successfully removed from tracking',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

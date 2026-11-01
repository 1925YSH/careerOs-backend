const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const Notification = require('../models/Notification');
const { NotFoundError } = require('../utils/errors');

/**
 * GET /api/notifications - List user notifications with filtering
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { unreadOnly, limit = 20, page = 1 } = req.query;
    const filter = { userId: req.user._id };

    if (unreadOnly === 'true') {
      filter.readAt = null;
    }

    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ userId: req.user._id, readAt: null }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        notifications,
        pagination: {
          total,
          page: parsedPage,
          limit: parsedLimit,
          totalPages: Math.ceil(total / parsedLimit),
        },
        unreadCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/notifications/unread-count - Fast endpoint for navbar notification badges
 */
router.get('/unread-count', authenticate, async (req, res, next) => {
  try {
    const unreadCount = await Notification.countDocuments({
      userId: req.user._id,
      readAt: null,
    });

    return res.status(200).json({
      success: true,
      data: { unreadCount },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/notifications/:id/read - Mark single notification as read
 */
router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!notification) {
      throw new NotFoundError('Notification not found or access denied');
    }

    if (!notification.readAt) {
      notification.readAt = new Date();
      await notification.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: { notification },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/notifications/read-all - Mark all unread notifications as read
 */
router.post('/read-all', authenticate, async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`,
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/notifications/test-seed - Seed realistic starter notifications if user inbox is empty
 */
router.post('/test-seed', authenticate, async (req, res, next) => {
  try {
    const existing = await Notification.countDocuments({ userId: req.user._id });
    if (existing > 0) {
      return res.status(200).json({
        success: true,
        message: 'Notifications already exist for this user',
      });
    }

    const samples = [
      {
        userId: req.user._id,
        type: 'job_match',
        title: 'New 94% Match Role Ingested',
        body: 'A Senior Full-Stack Engineer position matching your verified React & Node.js competencies was ingested from Stripe Careers.',
        link: '/app/jobs',
      },
      {
        userId: req.user._id,
        type: 'task_reminder',
        title: '7-Day Sprint Milestone Due Today',
        body: 'Day 2 task: "Core technical stack review & algorithmic challenge prep" is due today in your Career Agent sprint roadmap.',
        link: '/app/tasks',
      },
      {
        userId: req.user._id,
        type: 'system_alert',
        title: 'Welcome to AI CareerOS',
        body: 'Your autonomous career intelligence workspace is active. Upload your ATS resume to unlock deterministic match scoring.',
        link: '/app/resume',
      },
    ];

    await Notification.insertMany(samples);

    return res.status(201).json({
      success: true,
      message: 'Sample notifications seeded successfully',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;


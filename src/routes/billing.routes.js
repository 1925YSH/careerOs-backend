const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const stripeService = require('../services/stripe.service');
const Company = require('../models/Company');
const Job = require('../models/Job');
const AgentTask = require('../models/AgentTask');
const { ValidationError } = require('../utils/errors');

/**
 * GET /api/billing/plans - Public plan tiers and feature catalog
 */
router.get('/plans', (req, res) => {
  const plans = stripeService.getAvailablePlans();
  return res.status(200).json({
    success: true,
    data: plans,
  });
});

/**
 * GET /api/billing/subscription - Get current user/company subscription status & quotas
 */
router.get('/subscription', authenticate, async (req, res, next) => {
  try {
    const user = req.user;
    const role = user.role;
    let company = null;
    let quotaUsage = {};

    if (role === 'company') {
      company = await Company.findOne({ ownerUserId: user._id }).lean();
      const activeJobsCount = company
        ? await Job.countDocuments({ companyId: company._id, status: 'active' })
        : 0;

      const quota = company?.subscription?.jobPostingQuota || 2;
      quotaUsage = {
        activeJobs: activeJobsCount,
        maxJobs: quota,
        remainingJobs: Math.max(0, quota - activeJobsCount),
      };
    } else {
      // Candidate quota checks (e.g. 7-day roadmaps generated this week)
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentRoadmapTasks = await AgentTask.countDocuments({
        userId: user._id,
        type: 'interview_prep',
        createdAt: { $gte: oneWeekAgo },
      });

      const isPro = user.subscription?.plan === 'pro';
      quotaUsage = {
        roadmapsThisWeek: Math.min(recentRoadmapTasks, isPro ? 999 : 2),
        maxRoadmapsPerWeek: isPro ? 'unlimited' : 2,
        isPro,
      };
    }

    return res.status(200).json({
      success: true,
      data: {
        role,
        subscription: role === 'company' ? company?.subscription : user.subscription,
        quotaUsage,
        company: company
          ? {
              _id: company._id,
              name: company.name,
              verified: company.verified,
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/checkout - Create checkout session
 */
router.post('/checkout', authenticate, async (req, res, next) => {
  try {
    const { planId, billingCycle, successUrl, cancelUrl } = req.body;
    if (!planId) {
      throw new ValidationError('planId is required for checkout session');
    }

    const session = await stripeService.createCheckoutSession({
      user: req.user,
      planId,
      billingCycle: billingCycle || 'monthly',
      successUrl,
      cancelUrl,
    });

    return res.status(200).json({
      success: true,
      data: session,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/portal - Generate customer billing portal URL
 */
router.post('/portal', authenticate, async (req, res, next) => {
  try {
    const { returnUrl } = req.body;
    const session = await stripeService.createPortalSession({
      user: req.user,
      returnUrl,
    });

    return res.status(200).json({
      success: true,
      data: session,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/webhook - Stripe webhook receiver (with replay defense)
 */
router.post('/webhook', async (req, res, next) => {
  try {
    const event = req.body;
    const signature = req.headers['stripe-signature'];

    const result = await stripeService.handleWebhookEvent({
      event,
      signature,
    });

    return res.status(200).json({
      received: true,
      result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/mock-upgrade - Instant testing upgrade endpoint (for manual testers & QA)
 */
router.post('/mock-upgrade', authenticate, async (req, res, next) => {
  try {
    const { planId, billingCycle } = req.body;
    if (!planId) {
      throw new ValidationError('planId is required');
    }

    const result = await stripeService.mockUpgradeSubscription({
      userId: req.user._id,
      planId,
      billingCycle: billingCycle || 'monthly',
    });

    return res.status(200).json({
      success: true,
      message: `Subscription successfully upgraded to ${planId}`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;


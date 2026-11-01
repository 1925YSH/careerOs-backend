const env = require('../config/env');
const User = require('../models/User');
const Company = require('../models/Company');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');
const { ValidationError, NotFoundError, ConflictError } = require('../utils/errors');

/**
 * AI CareerOS - Monetization & Commercial Subscriptions Catalog
 */
const PLAN_CATALOG = {
  candidate: [
    {
      id: 'candidate_free',
      name: 'CareerOS Basic',
      price: { monthly: 0, annual: 0 },
      description: 'Essential job discovery and match evaluations',
      features: [
        'Explore verified jobs and company profiles',
        '2 AI interview preparation roadmaps per week',
        'Basic resume ATS formatting check',
        'Standard Kanban application tracker',
        'Standard job match scoring',
      ],
      quotas: {
        roadmapsPerWeek: 2,
        activeApplications: 25,
      },
    },
    {
      id: 'candidate_pro',
      name: 'CareerOS Pro',
      badge: 'Most Popular',
      price: { monthly: 19, annual: 149 },
      description: 'Autonomous career acceleration with unlimited AI assistance',
      features: [
        'Unlimited 7-day interview milestone sprint roadmaps',
        'In-depth ATS resume diagnostics & keyword gap analysis',
        'Real-time high-match email & in-app alerts',
        'Priority Career Agent chat reasoning',
        'Unlimited tracked applications & notes',
        'Early access to newly crawled employer listings',
      ],
      quotas: {
        roadmapsPerWeek: Infinity,
        activeApplications: Infinity,
      },
    },
  ],
  company: [
    {
      id: 'employer_free',
      name: 'Community Employer',
      price: { monthly: 0, annual: 0 },
      description: 'Post basic vacancies and receive inbound applicants',
      features: [
        'Up to 2 active job listings',
        'Standard company profile page',
        'Basic applicant pipeline view',
        'Candidate resume access via secure presigned URLs',
      ],
      quotas: {
        jobPostingQuota: 2,
      },
    },
    {
      id: 'employer_starter',
      name: 'Verified Starter',
      badge: 'Best for Startups',
      price: { monthly: 99, annual: 949 },
      description: 'Verified brand presence with enhanced job capacity',
      features: [
        'Up to 10 active job listings',
        'Official Verified Employer Shield Badge',
        'Automated career-page ingestion sync priority',
        'Full candidate application Kanban board',
        'Basic hiring analytics and view telemetry',
      ],
      quotas: {
        jobPostingQuota: 10,
      },
    },
    {
      id: 'employer_growth',
      name: 'Talent Growth',
      badge: 'Scale Hiring',
      price: { monthly: 299, annual: 2870 },
      description: 'Full-funnel automated hiring with unlimited reach',
      features: [
        'Unlimited active job postings',
        'Featured top-of-feed listing placement',
        'Official Verified Employer Shield Badge',
        'Candidate talent match recommendations',
        'Full CSV hiring analytics & funnel exports',
        'Dedicated crawler monitoring & SLA support',
      ],
      quotas: {
        jobPostingQuota: 9999,
      },
    },
  ],
};

let stripeClient = null;
if (env.STRIPE_SECRET_KEY) {
  try {
    const Stripe = require('stripe');
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16',
    });
    logger.info('Stripe client initialized with configured API credentials');
  } catch (err) {
    logger.warn('Failed to initialize Stripe client from package, fallback to simulation mode', {
      error: err.message,
    });
  }
}

/**
 * Retrieve public plan tiers
 */
function getAvailablePlans() {
  return PLAN_CATALOG;
}

/**
 * Create Checkout Session (Stripe Live or Dev Simulation)
 */
async function createCheckoutSession({ user, planId, billingCycle = 'monthly', successUrl, cancelUrl }) {
  const role = user.role;
  const plans = role === 'company' ? PLAN_CATALOG.company : PLAN_CATALOG.candidate;
  const targetPlan = plans.find((p) => p.id === planId);

  if (!targetPlan) {
    throw new ValidationError(`Invalid plan identifier: ${planId} for role: ${role}`);
  }

  if (targetPlan.price[billingCycle] === 0) {
    throw new ValidationError('Free plan does not require checkout session');
  }

  const effectiveSuccessUrl =
    successUrl || `${env.CLIENT_URL}/${role === 'company' ? 'company/settings' : 'app/settings'}?billing=success&plan=${planId}`;
  const effectiveCancelUrl =
    cancelUrl || `${env.CLIENT_URL}/pricing?billing=canceled`;

  // If live Stripe client is configured
  if (stripeClient && env.STRIPE_SECRET_KEY) {
    try {
      const session = await stripeClient.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        customer_email: user.email,
        client_reference_id: user._id.toString(),
        metadata: {
          userId: user._id.toString(),
          role,
          planId,
          billingCycle,
        },
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: targetPlan.name,
                description: targetPlan.description,
              },
              unit_amount: targetPlan.price[billingCycle] * 100,
              recurring: {
                interval: billingCycle === 'annual' ? 'year' : 'month',
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${effectiveSuccessUrl}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: effectiveCancelUrl,
      });

      return {
        checkoutUrl: session.url,
        sessionId: session.id,
        isSimulated: false,
      };
    } catch (err) {
      logger.error('Stripe checkout session creation failed, using secure simulation', { error: err.message });
    }
  }

  // Secure local development / staging simulation session
  const simSessionId = `sim_chk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const simulationCheckoutUrl = `${effectiveSuccessUrl}&session_id=${simSessionId}`;

  return {
    checkoutUrl: simulationCheckoutUrl,
    sessionId: simSessionId,
    isSimulated: true,
  };
}

/**
 * Create Customer Portal Session
 */
async function createPortalSession({ user, returnUrl }) {
  const effectiveReturnUrl =
    returnUrl || `${env.CLIENT_URL}/${user.role === 'company' ? 'company/settings' : 'app/settings'}`;

  const customerId = user.subscription?.stripeCustomerId;

  if (stripeClient && customerId) {
    try {
      const portalSession = await stripeClient.billingPortal.sessions.create({
        customer: customerId,
        return_url: effectiveReturnUrl,
      });
      return { url: portalSession.url, isSimulated: false };
    } catch (err) {
      logger.warn('Stripe billing portal session creation failed, fallback to local settings', { error: err.message });
    }
  }

  return {
    url: effectiveReturnUrl,
    isSimulated: true,
  };
}

/**
 * Handle Webhook Event with Replay Protection (OWASP Defense)
 */
async function handleWebhookEvent({ event, signature }) {
  if (!event || !event.id || !event.type) {
    throw new ValidationError('Invalid webhook payload structure');
  }

  // Replay Attack Protection: Check if this Stripe Event ID was already processed
  const existingAudit = await AuditLog.findOne({
    action: 'STRIPE_WEBHOOK_PROCESSED',
    'metadata.eventId': event.id,
  });

  if (existingAudit) {
    logger.warn('Duplicate Stripe webhook event detected (replay attack blocked)', {
      eventId: event.id,
      eventType: event.type,
    });
    return {
      status: 'duplicate_ignored',
      message: 'Event was already processed',
    };
  }

  const { type, data } = event;
  const object = data?.object;

  switch (type) {
    case 'checkout.session.completed': {
      const userId = object?.client_reference_id || object?.metadata?.userId;
      const planId = object?.metadata?.planId || 'candidate_pro';
      const billingCycle = object?.metadata?.billingCycle || 'monthly';
      const customerId = object?.customer;
      const subscriptionId = object?.subscription;

      if (userId) {
        const user = await User.findById(userId);
        if (user) {
          const isPro = planId.includes('pro');
          const isCompany = user.role === 'company';

          user.subscription = {
            plan: isPro ? 'pro' : 'enterprise',
            status: 'active',
            billingCycle,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            currentPeriodEnd: new Date(Date.now() + (billingCycle === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000),
            cancelAtPeriodEnd: false,
          };
          await user.save();

          if (isCompany) {
            const company = await Company.findOne({ ownerUserId: user._id });
            if (company) {
              const quota = planId.includes('growth') ? 9999 : 10;
              company.subscription = {
                plan: planId.includes('growth') ? 'growth' : 'starter',
                status: 'active',
                billingCycle,
                jobPostingQuota: quota,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
                currentPeriodEnd: user.subscription.currentPeriodEnd,
              };
              company.verified = true; // Starter and Growth tiers unlock verified shield
              await company.save();
            }
          }
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const customerId = object?.customer;
      const user = await User.findOne({ 'subscription.stripeCustomerId': customerId });
      if (user) {
        user.subscription.plan = 'free';
        user.subscription.status = 'canceled';
        await user.save();

        if (user.role === 'company') {
          const company = await Company.findOne({ ownerUserId: user._id });
          if (company) {
            company.subscription.plan = 'free';
            company.subscription.status = 'canceled';
            company.subscription.jobPostingQuota = 2;
            await company.save();
          }
        }
      }
      break;
    }

    default:
      logger.info('Stripe webhook received unhandled event type', { type });
      break;
  }

  // Record immutable audit entry for compliance and replay defense
  await AuditLog.create({
    actorId: object?.metadata?.userId || undefined,
    actorRole: 'system',
    action: 'STRIPE_WEBHOOK_PROCESSED',
    targetType: 'system',
    metadata: {
      eventId: event.id,
      eventType: type,
      customerId: object?.customer,
    },
  });

  return {
    status: 'success',
    eventId: event.id,
    type,
  };
}

/**
 * Mock Upgrade Helper (For QA Manual Testing & Integration Test Verification)
 */
async function mockUpgradeSubscription({ userId, planId, billingCycle = 'monthly' }) {
  const user = await User.findById(userId);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  const role = user.role;
  const plans = role === 'company' ? PLAN_CATALOG.company : PLAN_CATALOG.candidate;
  const targetPlan = plans.find((p) => p.id === planId);

  if (!targetPlan) {
    throw new ValidationError(`Unknown plan: ${planId}`);
  }

  const durationDays = billingCycle === 'annual' ? 365 : 30;
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

  let planName = 'free';
  if (role === 'candidate') {
    planName = planId.includes('pro') ? 'pro' : 'free';
  } else {
    planName = planId.includes('growth') ? 'growth' : planId.includes('starter') ? 'starter' : 'free';
  }

  user.subscription = {
    plan: planName,
    status: 'active',
    billingCycle,
    stripeCustomerId: `sim_cus_${userId.toString().slice(-6)}`,
    stripeSubscriptionId: `sim_sub_${Date.now()}`,
    currentPeriodEnd: expiresAt,
    cancelAtPeriodEnd: false,
  };
  await user.save();

  let companyData = null;
  if (role === 'company') {
    let company = await Company.findOne({ ownerUserId: user._id });
    if (company) {
      const quota = targetPlan.quotas?.jobPostingQuota || 2;
      company.subscription = {
        plan: planName,
        status: 'active',
        billingCycle,
        jobPostingQuota: quota,
        stripeCustomerId: user.subscription.stripeCustomerId,
        stripeSubscriptionId: user.subscription.stripeSubscriptionId,
        currentPeriodEnd: expiresAt,
      };
      if (planName !== 'free') {
        company.verified = true;
      }
      await company.save();
      companyData = company;
    }
  }

  await AuditLog.create({
    actorId: user._id,
    actorRole: user.role,
    action: 'SUBSCRIPTION_UPGRADED',
    targetType: 'user',
    targetId: user._id,
    metadata: {
      planId,
      billingCycle,
      expiresAt,
    },
  });

  return {
    user: user.toJSON(),
    company: companyData,
    plan: targetPlan,
  };
}

module.exports = {
  PLAN_CATALOG,
  getAvailablePlans,
  createCheckoutSession,
  createPortalSession,
  handleWebhookEvent,
  mockUpgradeSubscription,
};

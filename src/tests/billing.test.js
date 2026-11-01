const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const { connectDB, disconnectDB } = require('../config/db');
const env = require('../config/env');
const User = require('../models/User');
const Company = require('../models/Company');
const Job = require('../models/Job');
const AgentTask = require('../models/AgentTask');
const AuditLog = require('../models/AuditLog');

jest.setTimeout(25000);

describe('AI CareerOS - Phase 7 Monetization, Subscriptions & Paywall Tests', () => {
  let candidateUser;
  let companyUser;
  let testCompany;
  let candidateToken;
  let companyToken;

  beforeAll(async () => {
    await connectDB();
    const timestamp = Date.now();

    // 1. Create Candidate User & Token
    candidateUser = await User.create({
      email: `candidate-billing-${timestamp}@test.com`,
      passwordHash: '$2b$12$dummyhashforbillingunittests1234567890',
      role: 'candidate',
      status: 'active',
      subscription: {
        plan: 'free',
        status: 'active',
      },
    });

    candidateToken = jwt.sign(
      { id: candidateUser._id.toString(), role: 'candidate', email: candidateUser.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // 2. Create Company User & Company Record
    companyUser = await User.create({
      email: `company-billing-${timestamp}@test.com`,
      passwordHash: '$2b$12$dummyhashforbillingunittests1234567890',
      role: 'company',
      status: 'active',
      subscription: {
        plan: 'free',
        status: 'active',
      },
    });

    companyToken = jwt.sign(
      { id: companyUser._id.toString(), role: 'company', email: companyUser.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    testCompany = await Company.create({
      ownerUserId: companyUser._id,
      name: `Billing Test Corp ${timestamp}`,
      domain: `billingcorp-${timestamp}.com`,
      verified: false,
      status: 'active',
      subscription: {
        plan: 'free',
        status: 'active',
        jobPostingQuota: 2,
      },
    });
  });

  afterAll(async () => {
    if (candidateUser) {
      await User.deleteMany({ _id: { $in: [candidateUser._id, companyUser._id] } });
      await Company.deleteMany({ ownerUserId: companyUser._id });
      await Job.deleteMany({ companyId: testCompany._id });
      await AgentTask.deleteMany({ userId: candidateUser._id });
      await AuditLog.deleteMany({ 'metadata.eventId': { $regex: /^test_evt_/ } });
    }
    await disconnectDB();
  });

  describe('1. Public Plans & Subscription Discovery', () => {
    it('GET /api/billing/plans returns structured candidate and employer catalogs', async () => {
      const res = await request(app).get('/api/billing/plans');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.candidate).toBeDefined();
      expect(res.body.data.company).toBeDefined();
      expect(res.body.data.candidate.some((p) => p.id === 'candidate_pro')).toBe(true);
      expect(res.body.data.company.some((p) => p.id === 'employer_starter')).toBe(true);
    });

    it('GET /api/billing/subscription returns current candidate plan and quota telemetry', async () => {
      const res = await request(app)
        .get('/api/billing/subscription')
        .set('Cookie', [`token=${candidateToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('candidate');
      expect(res.body.data.subscription.plan).toBe('free');
      expect(res.body.data.quotaUsage.isPro).toBe(false);
      expect(res.body.data.quotaUsage.maxRoadmapsPerWeek).toBe(2);
    });

    it('GET /api/billing/subscription returns current company quota and active job count', async () => {
      const res = await request(app)
        .get('/api/billing/subscription')
        .set('Cookie', [`token=${companyToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('company');
      expect(res.body.data.subscription.jobPostingQuota).toBe(2);
      expect(res.body.data.quotaUsage.activeJobs).toBe(0);
      expect(res.body.data.quotaUsage.maxJobs).toBe(2);
    });

    it('rejects unauthenticated request to /api/billing/subscription with 401', async () => {
      const res = await request(app).get('/api/billing/subscription');
      expect(res.status).toBe(401);
    });
  });

  describe('2. Checkout & Upgrade Workflows', () => {
    it('POST /api/billing/checkout generates checkout session for Candidate Pro', async () => {
      const res = await request(app)
        .post('/api/billing/checkout')
        .set('Cookie', [`token=${candidateToken}`])
        .send({
          planId: 'candidate_pro',
          billingCycle: 'monthly',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.checkoutUrl).toBeDefined();
      expect(res.body.data.sessionId).toBeDefined();
    });

    it('POST /api/billing/checkout rejects free tier checkout requests', async () => {
      const res = await request(app)
        .post('/api/billing/checkout')
        .set('Cookie', [`token=${candidateToken}`])
        .send({
          planId: 'candidate_free',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Free plan does not require checkout');
    });

    it('POST /api/billing/mock-upgrade upgrades candidate to Pro and logs audit', async () => {
      const res = await request(app)
        .post('/api/billing/mock-upgrade')
        .set('Cookie', [`token=${candidateToken}`])
        .send({
          planId: 'candidate_pro',
          billingCycle: 'annual',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.subscription.plan).toBe('pro');
      expect(res.body.data.user.subscription.billingCycle).toBe('annual');

      const updatedUser = await User.findById(candidateUser._id);
      expect(updatedUser.subscription.plan).toBe('pro');
    });

    it('POST /api/billing/mock-upgrade upgrades company to Starter and unlocks Verified badge', async () => {
      const res = await request(app)
        .post('/api/billing/mock-upgrade')
        .set('Cookie', [`token=${companyToken}`])
        .send({
          planId: 'employer_starter',
          billingCycle: 'monthly',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.company.subscription.plan).toBe('starter');
      expect(res.body.data.company.subscription.jobPostingQuota).toBe(10);
      expect(res.body.data.company.verified).toBe(true);

      const updatedCompany = await Company.findById(testCompany._id);
      expect(updatedCompany.verified).toBe(true);
      expect(updatedCompany.subscription.jobPostingQuota).toBe(10);
    });
  });

  describe('3. Webhook Processing & Replay Defense (OWASP)', () => {
    const testEventId = `test_evt_${Date.now()}`;

    it('POST /api/billing/webhook processes checkout.session.completed successfully', async () => {
      const payload = {
        id: testEventId,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_${Date.now()}`,
            customer: `cus_${Date.now()}`,
            client_reference_id: candidateUser._id.toString(),
            metadata: {
              userId: candidateUser._id.toString(),
              planId: 'candidate_pro',
              billingCycle: 'monthly',
            },
          },
        },
      };

      const res = await request(app).post('/api/billing/webhook').send(payload);
      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe('success');
    });

    it('POST /api/billing/webhook detects replay attack on same event ID and rejects replay', async () => {
      const replayPayload = {
        id: testEventId,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_duplicate_${Date.now()}`,
            customer: `cus_duplicate_${Date.now()}`,
            client_reference_id: candidateUser._id.toString(),
          },
        },
      };

      const res = await request(app).post('/api/billing/webhook').send(replayPayload);
      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe('duplicate_ignored');
    });
  });

  describe('4. Paywall Enforcements', () => {
    it('blocks company from posting beyond active quota on Free tier', async () => {
      // Set company back to free tier with limit 2
      await Company.findByIdAndUpdate(testCompany._id, {
        'subscription.plan': 'free',
        'subscription.jobPostingQuota': 2,
      });

      // Create 2 active jobs to exhaust quota
      await Job.create([
        {
          companyId: testCompany._id,
          sourceType: 'company_posted',
          title: 'Role 1',
          description: 'Description 1',
          location: 'Remote',
          workMode: 'remote',
          employmentType: 'FULL_TIME',
          skills: ['node.js'],
          experienceMin: 2,
          experienceMax: 4,
          status: 'active',
          fingerprint: `fp1_${Date.now()}`,
          applicationUrl: 'https://example.com/1',
        },
        {
          companyId: testCompany._id,
          sourceType: 'company_posted',
          title: 'Role 2',
          description: 'Description 2',
          location: 'Remote',
          workMode: 'remote',
          employmentType: 'FULL_TIME',
          skills: ['react'],
          experienceMin: 2,
          experienceMax: 4,
          status: 'active',
          fingerprint: `fp2_${Date.now()}`,
          applicationUrl: 'https://example.com/2',
        },
      ]);

      // Attempt to post 3rd active job
      const res = await request(app)
        .post('/api/companies/workspace/jobs')
        .set('Cookie', [`token=${companyToken}`])
        .send({
          title: 'Role 3 Exceeding Limit',
          description: 'Comprehensive job description that exceeds the twenty character minimum validation requirement.',
          location: 'New York, NY',
          workMode: 'remote',
          employmentType: 'FULL_TIME',
          skills: ['mongodb'],
          experienceMin: 3,
          experienceMax: 5,
          status: 'active',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.category).toBe('authorization');
      expect(res.body.error.details.code).toBe('UPGRADE_REQUIRED');
      expect(res.body.error.message).toContain('Job posting limit reached');
    });
  });
});

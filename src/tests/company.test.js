const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../app');
const { connectDB, disconnectDB } = require('../config/db');
const env = require('../config/env');
const User = require('../models/User');
const Company = require('../models/Company');
const Job = require('../models/Job');
const Application = require('../models/Application');

jest.setTimeout(25000);

describe('AI CareerOS - Phase 3 Company Workspace & BOLA Isolation Tests', () => {
  let companyAUser;
  let companyBUser;
  let candidateUser;
  let tokenCompanyA;
  let tokenCompanyB;
  let tokenCandidate;
  let companyA;
  let companyB;
  let jobA;

  beforeAll(async () => {
    await connectDB();

    const timestamp = Date.now();

    // Create real User records in MongoDB Atlas
    companyAUser = await User.create({
      email: `founder-${timestamp}@companya.test`,
      passwordHash: '$2b$12$e/dummyhashfordeterministicunittesting1234567890',
      role: 'company',
      status: 'active',
    });

    companyBUser = await User.create({
      email: `hr-${timestamp}@companyb.test`,
      passwordHash: '$2b$12$e/dummyhashfordeterministicunittesting1234567890',
      role: 'company',
      status: 'active',
    });

    candidateUser = await User.create({
      email: `dev-${timestamp}@candidate.test`,
      passwordHash: '$2b$12$e/dummyhashfordeterministicunittesting1234567890',
      role: 'candidate',
      status: 'active',
    });

    tokenCompanyA = jwt.sign(
      { id: companyAUser._id.toString(), role: companyAUser.role, email: companyAUser.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    tokenCompanyB = jwt.sign(
      { id: companyBUser._id.toString(), role: companyBUser.role, email: companyBUser.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    tokenCandidate = jwt.sign(
      { id: candidateUser._id.toString(), role: candidateUser.role, email: candidateUser.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Create companies linked to users
    companyA = await Company.create({
      ownerUserId: companyAUser._id,
      name: 'Company Alpha Test',
      domain: `alpha-${timestamp}.test`,
      status: 'active',
      verified: true,
      description: 'Test Company Alpha',
    });

    companyB = await Company.create({
      ownerUserId: companyBUser._id,
      name: 'Company Beta Test',
      domain: `beta-${timestamp}.test`,
      status: 'active',
      verified: false,
      description: 'Test Company Beta',
    });

    // Create a job owned by Company A
    jobA = await Job.create({
      companyId: companyA._id,
      title: 'Senior Systems Architect',
      description: 'Build large-scale fault-tolerant event streams using Node.js and Kafka.',
      location: 'San Francisco, CA',
      workMode: 'remote',
      employmentType: 'FULL_TIME',
      skills: ['node.js', 'kafka', 'distributed systems'],
      experienceMin: 5,
      applicationUrl: 'https://companya.test/apply',
      sourceType: 'company_posted',
      status: 'active',
    });
  });

  afterAll(async () => {
    try {
      if (companyA && companyB) {
        await Promise.all([
          User.deleteMany({ _id: { $in: [companyAUser._id, companyBUser._id, candidateUser._id] } }),
          Company.deleteMany({ _id: { $in: [companyA._id, companyB._id] } }),
          Job.deleteMany({ companyId: { $in: [companyA._id, companyB._id] } }),
          Application.deleteMany({ companyId: { $in: [companyA._id, companyB._id] } }),
        ]);
      }
    } finally {
      await disconnectDB();
    }
  });

  describe('1. Role-Based Access Control on Company Workspace', () => {
    it('returns 403 Forbidden when a Candidate attempts to access Company Dashboard', async () => {
      const res = await request(app)
        .get('/api/companies/workspace/dashboard')
        .set('Authorization', `Bearer ${tokenCandidate}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.category).toBe('authorization');
    });

    it('returns 401 Unauthorized when an unauthenticated guest accesses Company Workspace', async () => {
      const res = await request(app).get('/api/companies/workspace/dashboard');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.category).toBe('authentication');
    });

    it('returns 200 OK when authenticated Company A accesses dashboard', async () => {
      const res = await request(app)
        .get('/api/companies/workspace/dashboard')
        .set('Authorization', `Bearer ${tokenCompanyA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stats).toBeDefined();
      expect(res.body.data.stats.activeJobs).toBeGreaterThanOrEqual(1);
    });
  });

  describe('2. Job Creation & Server-side Validation', () => {
    it('rejects job creation when salary max is less than salary min', async () => {
      const res = await request(app)
        .post('/api/companies/workspace/jobs')
        .set('Authorization', `Bearer ${tokenCompanyA}`)
        .send({
          title: 'Full Stack Engineer',
          description: 'A comprehensive full stack engineering role with modern web technologies.',
          location: 'New York, NY',
          workMode: 'hybrid',
          skills: ['typescript', 'react'],
          salary: {
            min: 150000,
            max: 120000, // Invalid: max < min
            currency: 'USD',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.category).toBe('validation');
    });

    it('successfully creates job and hashes SHA-256 fingerprint for deduplication', async () => {
      const res = await request(app)
        .post('/api/companies/workspace/jobs')
        .set('Authorization', `Bearer ${tokenCompanyA}`)
        .send({
          title: 'Staff Security Engineer',
          description: 'Lead application security reviews, threat modeling, and OWASP compliance audits.',
          location: 'Remote',
          workMode: 'remote',
          skills: ['appsec', 'owasp', 'penetration testing'],
          experienceMin: 4,
          salary: {
            min: 160000,
            max: 200000,
            currency: 'USD',
            isDisclosed: true,
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.job.fingerprint).toBeDefined();
      expect(res.body.data.job.sourceType).toBe('company_posted');
      expect(res.body.data.job.companyId.toString()).toBe(companyA._id.toString());
    });
  });

  describe('3. Strict BOLA / IDOR Protection (Multi-Tenant Isolation)', () => {
    it('prevents Company B from modifying a job owned by Company A (404/denied)', async () => {
      const res = await request(app)
        .patch(`/api/companies/workspace/jobs/${jobA._id}`)
        .set('Authorization', `Bearer ${tokenCompanyB}`)
        .send({
          title: 'Hacked Title Attempt',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);

      // Verify in DB that job was untouched
      const freshJob = await Job.findById(jobA._id);
      expect(freshJob.title).toBe('Senior Systems Architect');
    });

    it('prevents Company B from archiving/deleting a job owned by Company A', async () => {
      const res = await request(app)
        .delete(`/api/companies/workspace/jobs/${jobA._id}`)
        .set('Authorization', `Bearer ${tokenCompanyB}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);

      const freshJob = await Job.findById(jobA._id);
      expect(freshJob.status).toBe('active');
    });
  });

  describe('4. SSRF Defense on Career Source Ingestion Registration', () => {
    it('blocks internal cloud metadata IP (169.254.169.254) submission with validation error', async () => {
      const res = await request(app)
        .post('/api/companies/workspace/source')
        .set('Authorization', `Bearer ${tokenCompanyA}`)
        .send({
          careersUrl: 'http://169.254.169.254/latest/meta-data',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Security rejection/i);
    });

    it('blocks localhost / loopback URL submission with validation error', async () => {
      const res = await request(app)
        .post('/api/companies/workspace/source')
        .set('Authorization', `Bearer ${tokenCompanyA}`)
        .send({
          careersUrl: 'http://127.0.0.1:8080/internal-admin',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Security rejection/i);
    });
  });
});

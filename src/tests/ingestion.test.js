const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../app');
const { connectDB, disconnectDB } = require('../config/db');
const env = require('../config/env');
const User = require('../models/User');
const Company = require('../models/Company');
const Job = require('../models/Job');
const JobSource = require('../models/JobSource');
const IngestionRun = require('../models/IngestionRun');
const { cleanHtml } = require('../ingestion/cleaner');
const { extractJsonLd, extractSemanticHtml, parseJobPage } = require('../ingestion/parser');
const { generateJobFingerprint, deduplicateAndUpsert } = require('../ingestion/dedupe');
const { safeFetch } = require('../ingestion/fetcher');

jest.setTimeout(25000);

describe('AI CareerOS - Phase 5 Automated Ingestion Engine & SSRF Guard Tests', () => {
  let adminUser;
  let candidateUser;
  let companyUser;
  let testCompany;
  let adminToken;
  let candidateToken;

  beforeAll(async () => {
    await connectDB();
    const timestamp = Date.now();

    // Create Admin User
    adminUser = await User.create({
      email: `admin-${timestamp}@careeros.com`,
      passwordHash: '$2b$12$dummyhashforphase5unittesting1234567890',
      role: 'admin',
      status: 'active',
    });

    // Create Candidate User
    candidateUser = await User.create({
      email: `candidate-${timestamp}@careeros.com`,
      passwordHash: '$2b$12$dummyhashforphase5unittesting1234567890',
      role: 'candidate',
      status: 'active',
    });

    // Create Company & User
    companyUser = await User.create({
      email: `recruiter-${timestamp}@stripe.com`,
      passwordHash: '$2b$12$dummyhashforphase5unittesting1234567890',
      role: 'company',
      status: 'active',
    });

    testCompany = await Company.create({
      name: `Stripe Test ${timestamp}`,
      domain: `stripetest${timestamp}.com`,
      ownerUserId: companyUser._id,
      verified: true,
    });

    adminToken = jwt.sign(
      { id: adminUser._id.toString(), role: 'admin', email: adminUser.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    candidateToken = jwt.sign(
      { id: candidateUser._id.toString(), role: 'candidate', email: candidateUser.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    if (adminUser) {
      await User.deleteMany({
        _id: { $in: [adminUser._id, candidateUser._id, companyUser._id] },
      });
      await Company.deleteMany({ _id: testCompany._id });
      await JobSource.deleteMany({ companyId: testCompany._id });
      await Job.deleteMany({ companyId: testCompany._id });
      await IngestionRun.deleteMany({});
    }
    await disconnectDB();
  });

  describe('1. Content Cleaner (DOM Purification)', () => {
    it('strips script, style, comments, nav, footer and cookie banners', () => {
      const dirtyHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <script>alert("malicious xss")</script>
            <style>body { background: red; }</style>
          </head>
          <body>
            <header><nav>Home | Careers | About</nav></header>
            <!-- Tracking comment -->
            <div id="cookie-consent-banner" class="cookie-banner">
              <p>We use cookies. Click accept.</p>
              <button>Accept</button>
            </div>
            <main>
              <h1>Staff Platform Engineer</h1>
              <p>We are seeking a Staff Platform Engineer to scale our distributed cloud systems.</p>
              <ul>
                <li>Kubernetes</li>
                <li>Go or Python</li>
                <li>AWS</li>
              </ul>
              <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="badge" />
            </main>
            <footer>
              <p>Copyright 2026 Stripe Inc.</p>
            </footer>
          </body>
        </html>
      `;

      const { cleanedHtml, cleanedText } = cleanHtml(dirtyHtml);

      // Noise tags and banners should be completely removed
      expect(cleanedHtml).not.toContain('<script');
      expect(cleanedHtml).not.toContain('malicious xss');
      expect(cleanedHtml).not.toContain('<style');
      expect(cleanedHtml).not.toContain('cookie-consent-banner');
      expect(cleanedHtml).not.toContain('Click accept');
      expect(cleanedHtml).not.toContain('Copyright 2026');
      expect(cleanedHtml).not.toContain('Tracking comment');
      expect(cleanedHtml).not.toContain('data:image/png;base64');

      // Genuine job content must be preserved
      expect(cleanedText).toContain('Staff Platform Engineer');
      expect(cleanedText).toContain('Kubernetes');
      expect(cleanedText).toContain('Go or Python');
    });
  });

  describe('2. Parser (JSON-LD & Semantic HTML)', () => {
    it('extracts Schema.org/JobPosting JSON-LD with structured salary and skills', () => {
      const htmlWithJsonLd = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org/",
                "@type": "JobPosting",
                "title": "Senior Distributed Systems Engineer",
                "description": "<p>Build high-throughput event processing pipelines.</p>",
                "datePosted": "2026-10-20T00:00:00Z",
                "employmentType": "FULL_TIME",
                "jobLocationType": "TELECOMMUTE",
                "skills": ["Distributed Systems", "Kafka", "Go", "PostgreSQL"],
                "baseSalary": {
                  "@type": "MonetaryAmount",
                  "currency": "USD",
                  "value": {
                    "@type": "QuantitativeValue",
                    "minValue": 180000,
                    "maxValue": 220000,
                    "unitText": "YEAR"
                  }
                },
                "url": "https://stripe.com/jobs/senior-distributed-systems"
              }
            </script>
          </head>
          <body><h1>Fallback Body</h1></body>
        </html>
      `;

      const jobs = extractJsonLd(htmlWithJsonLd, 'https://stripe.com/careers');

      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      expect(job.title).toBe('Senior Distributed Systems Engineer');
      expect(job.workMode).toBe('remote');
      expect(job.employmentType).toBe('FULL_TIME');
      expect(job.salary.isDisclosed).toBe(true);
      expect(job.salary.min).toBe(180000);
      expect(job.salary.max).toBe(220000);
      expect(job.skills).toContain('kafka');
      expect(job.skills).toContain('go');
      expect(job.applicationUrl).toBe('https://stripe.com/jobs/senior-distributed-systems');
    });

    it('extracts semantic HTML fallback when JSON-LD is absent', () => {
      const semanticHtml = `
        <html>
          <body>
            <main>
              <h1 class="job-title">Senior Full Stack Developer</h1>
              <span class="location">San Francisco, CA</span>
              <div class="job-description">
                <p>We are hiring a Senior Full Stack Developer to build modern apps with React, Node.js, and TypeScript.</p>
                <p>Salary: $140,000 - $175,000 per year</p>
              </div>
            </main>
          </body>
        </html>
      `;

      const jobs = extractSemanticHtml(semanticHtml, 'https://stripe.com/jobs/fullstack');

      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      expect(job.title).toBe('Senior Full Stack Developer');
      expect(job.location).toBe('San Francisco, CA');
      expect(job.salary.isDisclosed).toBe(true);
      expect(job.salary.min).toBe(140000);
      expect(job.salary.max).toBe(175000);
      expect(job.skills).toContain('react');
      expect(job.skills).toContain('node.js');
      expect(job.skills).toContain('typescript');
    });
  });

  describe('3. Cryptographic Fingerprint & Deduplication', () => {
    it('generates deterministic SHA-256 fingerprint ignoring whitespace and case', () => {
      const fp1 = generateJobFingerprint('stripe.com', 'Senior Software Engineer', 'San Francisco, CA');
      const fp2 = generateJobFingerprint('STRIPE.COM ', ' senior   software engineer ', 'san francisco, ca');
      const fpDiff = generateJobFingerprint('stripe.com', 'Staff Software Engineer', 'San Francisco, CA');

      expect(fp1).toBe(fp2);
      expect(fp1).not.toBe(fpDiff);
      expect(fp1).toHaveLength(64); // SHA-256 hex length
    });

    it('creates new job on first ingestion and updates lastSeenAt on re-crawl without duplicating', async () => {
      const jobData = {
        title: 'Backend Infrastructure Specialist',
        location: 'New York, NY',
        workMode: 'hybrid',
        employmentType: 'FULL_TIME',
        skills: ['go', 'kubernetes', 'docker'],
        description: 'Lead our container platform.',
        applicationUrl: 'https://stripetest.com/apply/infra-1',
      };

      const source = { careersUrl: 'https://stripetest.com/careers' };

      // First ingestion pass: should create
      const result1 = await deduplicateAndUpsert({
        jobData,
        company: testCompany,
        source,
      });

      expect(result1.action).toBe('created');
      expect(result1.isDuplicate).toBe(false);
      expect(result1.job.fingerprint).toBeDefined();

      const initialJobId = result1.job._id;

      // Second ingestion pass: should recognize duplicate and update lastSeenAt
      const result2 = await deduplicateAndUpsert({
        jobData,
        company: testCompany,
        source,
      });

      expect(result2.action).toBe('updated');
      expect(result2.isDuplicate).toBe(true);
      expect(result2.job._id.toString()).toBe(initialJobId.toString());

      // Verify DB count: strictly 1 record
      const count = await Job.countDocuments({ fingerprint: result1.job.fingerprint });
      expect(count).toBe(1);
    });
  });

  describe('4. SSRF Defense & Fetcher Security', () => {
    it('rejects loopback localhost targets', async () => {
      await expect(safeFetch('http://127.0.0.1:8080/admin')).rejects.toThrow(/SSRF Security Rejection/i);
      await expect(safeFetch('http://localhost:5000/internal')).rejects.toThrow(/SSRF Security Rejection/i);
    });

    it('rejects AWS metadata target (169.254.169.254)', async () => {
      await expect(safeFetch('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
        /SSRF Security Rejection/i
      );
    });

    it('rejects private network ranges (10.0.0.0/8, 192.168.0.0/16)', async () => {
      await expect(safeFetch('http://10.0.0.1/careers')).rejects.toThrow(/SSRF Security Rejection/i);
      await expect(safeFetch('http://192.168.1.1/jobs')).rejects.toThrow(/SSRF Security Rejection/i);
    });

    it('rejects domain not in allowedDomains allowlist', async () => {
      await expect(
        safeFetch('https://example.com/careers', ['stripe.com', 'google.com'])
      ).rejects.toThrow(/not in the approved allowedDomains list/i);
    });
  });

  describe('5. Admin Source Registry & Ingestion API (RBAC Guarded)', () => {
    let createdSourceId;

    it('forbids candidate access to admin endpoints (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/admin/overview')
        .set('Cookie', [`token=${candidateToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('allows admin to register a new verified JobSource with SSRF check', async () => {
      const res = await request(app)
        .post('/api/admin/sources')
        .set('Cookie', [`token=${adminToken}`])
        .send({
          companyId: testCompany._id,
          careersUrl: 'https://example.com/careers',
          allowedDomains: ['example.com'],
          parserStrategy: 'generic_html',
          crawlIntervalHours: 12,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.source.careersUrl).toBe('https://example.com/careers');
      expect(res.body.data.source.active).toBe(true);
      createdSourceId = res.body.data.source._id;
    });

    it('rejects source registration with private IP URL (SSRF Blocked)', async () => {
      const res = await request(app)
        .post('/api/admin/sources')
        .set('Cookie', [`token=${adminToken}`])
        .send({
          companyId: testCompany._id,
          careersUrl: 'http://169.254.169.254/internal-jobs',
          allowedDomains: ['169.254.169.254'],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/SSRF/i);
    });

    it('allows admin to list registered sources', async () => {
      const res = await request(app)
        .get('/api/admin/sources')
        .set('Cookie', [`token=${adminToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.sources)).toBe(true);
      expect(res.body.data.sources.some((s) => s._id.toString() === createdSourceId.toString())).toBe(true);
    });

    it('allows admin to patch source configuration', async () => {
      const res = await request(app)
        .patch(`/api/admin/sources/${createdSourceId}`)
        .set('Cookie', [`token=${adminToken}`])
        .send({
          crawlIntervalHours: 48,
          active: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.source.crawlIntervalHours).toBe(48);
      expect(res.body.data.source.active).toBe(false);
    });

    it('allows admin to moderate a job status (active -> flagged)', async () => {
      const job = await Job.findOne({ companyId: testCompany._id });
      expect(job).toBeDefined();

      const res = await request(app)
        .patch(`/api/admin/jobs/${job._id}/status`)
        .set('Cookie', [`token=${adminToken}`])
        .send({
          status: 'flagged',
          reason: 'Reviewing compensation accuracy',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.job.status).toBe('flagged');

      const updatedJob = await Job.findById(job._id);
      expect(updatedJob.status).toBe('flagged');
    });

    it('allows admin to fetch overview metrics including ingestion health', async () => {
      const res = await request(app)
        .get('/api/admin/overview')
        .set('Cookie', [`token=${adminToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stats).toHaveProperty('activeJobs');
      expect(res.body.data.stats).toHaveProperty('activeSources');
      expect(res.body.data.stats).toHaveProperty('failedIngestionRuns');
      expect(res.body.data.stats).toHaveProperty('ingestedJobs');
    });
  });
});

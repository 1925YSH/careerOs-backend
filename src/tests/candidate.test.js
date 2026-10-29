const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../app');
const { connectDB, disconnectDB } = require('../config/db');
const env = require('../config/env');
const User = require('../models/User');
const Company = require('../models/Company');
const Job = require('../models/Job');
const Resume = require('../models/Resume');
const Application = require('../models/Application');
const CandidateProfile = require('../models/CandidateProfile');

jest.setTimeout(25000);

describe('AI CareerOS - Phase 4 Candidate Workspace, Resume Center & S3 Security Tests', () => {
  let candidateA;
  let candidateB;
  let companyUser;
  let company;
  let testJob;
  let tokenCandidateA;
  let tokenCandidateB;
  let tokenCompany;
  let resumeA;

  beforeAll(async () => {
    await connectDB();
    const timestamp = Date.now();

    // Create candidates
    candidateA = await User.create({
      email: `candidate-a-${timestamp}@test.com`,
      passwordHash: '$2b$12$dummyhashforphase4unittesting1234567890',
      role: 'candidate',
      status: 'active',
    });

    candidateB = await User.create({
      email: `candidate-b-${timestamp}@test.com`,
      passwordHash: '$2b$12$dummyhashforphase4unittesting1234567890',
      role: 'candidate',
      status: 'active',
    });

    companyUser = await User.create({
      email: `recruiter-${timestamp}@test.com`,
      passwordHash: '$2b$12$dummyhashforphase4unittesting1234567890',
      role: 'company',
      status: 'active',
    });

    tokenCandidateA = jwt.sign(
      { id: candidateA._id.toString(), role: candidateA.role, email: candidateA.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    tokenCandidateB = jwt.sign(
      { id: candidateB._id.toString(), role: candidateB.role, email: candidateB.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    tokenCompany = jwt.sign(
      { id: companyUser._id.toString(), role: companyUser.role, email: companyUser.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    company = await Company.create({
      ownerUserId: companyUser._id,
      name: 'Vercel Test Corp',
      domain: `vercel-${timestamp}.test`,
      status: 'active',
      verified: true,
    });

    testJob = await Job.create({
      companyId: company._id,
      title: 'Frontend Platform Engineer',
      description: 'Build fast edge applications with Next.js and TypeScript.',
      location: 'San Francisco, CA',
      workMode: 'remote',
      employmentType: 'FULL_TIME',
      skills: ['react', 'next.js', 'typescript'],
      applicationUrl: 'https://vercel.test/jobs/frontend',
      status: 'active',
    });
  });

  afterAll(async () => {
    try {
      if (candidateA && candidateB) {
        await Promise.all([
          User.deleteMany({ _id: { $in: [candidateA._id, candidateB._id, companyUser._id] } }),
          Company.deleteMany({ _id: company._id }),
          Job.deleteMany({ companyId: company._id }),
          Resume.deleteMany({ userId: { $in: [candidateA._id, candidateB._id] } }),
          Application.deleteMany({ candidateId: { $in: [candidateA._id, candidateB._id] } }),
          CandidateProfile.deleteMany({ userId: { $in: [candidateA._id, candidateB._id] } }),
        ]);
      }
    } finally {
      await disconnectDB();
    }
  });

  describe('1. Resume Presigned URL Generation & Security Boundaries', () => {
    it('rejects executable / unauthorized MIME types (e.g. application/x-msdownload)', async () => {
      const res = await request(app)
        .post('/api/resumes/presign')
        .set('Authorization', `Bearer ${tokenCandidateA}`)
        .send({
          fileName: 'malware.exe',
          mimeType: 'application/x-msdownload',
          size: 1024,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.category).toBe('validation');
    });

    it('rejects files exceeding the 5MB upload threshold', async () => {
      const res = await request(app)
        .post('/api/resumes/presign')
        .set('Authorization', `Bearer ${tokenCandidateA}`)
        .send({
          fileName: 'large_portfolio.pdf',
          mimeType: 'application/pdf',
          size: 6 * 1024 * 1024, // 6MB
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/exceeds the 5MB/i);
    });

    it('generates presigned upload URL with user-isolated UUID s3Key for valid PDF', async () => {
      const res = await request(app)
        .post('/api/resumes/presign')
        .set('Authorization', `Bearer ${tokenCandidateA}`)
        .send({
          fileName: 'Jane_Doe_Resume_2026.pdf',
          mimeType: 'application/pdf',
          size: 250000,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.s3Key).toMatch(new RegExp(`^resumes/${candidateA._id}/[a-f0-9-]+.pdf$`));
      expect(res.body.data.expiresInSeconds).toBe(900);
    });
  });

  describe('2. Resume Registration, Versioning & Default Status', () => {
    it('creates first resume version and automatically sets isDefault=true', async () => {
      const fakeS3Key = `resumes/${candidateA._id}/${new mongoose.Types.ObjectId()}.pdf`;

      const res = await request(app)
        .post('/api/resumes')
        .set('Authorization', `Bearer ${tokenCandidateA}`)
        .send({
          s3Key: fakeS3Key,
          fileName: 'Jane_Doe_Resume.pdf',
          mimeType: 'application/pdf',
          size: 150000,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.resume.isDefault).toBe(true);
      expect(res.body.data.resume.version).toBe(1);
      expect(res.body.data.resume.parsedContent.skillsDetected.length).toBeGreaterThan(0);

      resumeA = res.body.data.resume;
    });

    it('rejects attempt to register resume with s3Key belonging to a different user', async () => {
      const stolenKey = `resumes/${candidateA._id}/stolen-file.pdf`;

      const res = await request(app)
        .post('/api/resumes')
        .set('Authorization', `Bearer ${tokenCandidateB}`)
        .send({
          s3Key: stolenKey,
          fileName: 'Stolen.pdf',
          mimeType: 'application/pdf',
          size: 100000,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.category).toBe('authorization');
    });
  });

  describe('3. Strict BOLA / IDOR Resume Document Protection', () => {
    it('prevents Candidate B from downloading Candidate A resume (404/denied)', async () => {
      const res = await request(app)
        .get(`/api/resumes/${resumeA._id}`)
        .set('Authorization', `Bearer ${tokenCandidateB}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('allows Candidate A to download own resume with short-lived presigned URL', async () => {
      const res = await request(app)
        .get(`/api/resumes/${resumeA._id}`)
        .set('Authorization', `Bearer ${tokenCandidateA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
      expect(res.body.data.resume._id.toString()).toBe(resumeA._id.toString());
    });

    it('prevents Candidate B from deleting Candidate A resume', async () => {
      const res = await request(app)
        .delete(`/api/resumes/${resumeA._id}`)
        .set('Authorization', `Bearer ${tokenCandidateB}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);

      const stillExists = await Resume.findById(resumeA._id);
      expect(stillExists).toBeDefined();
    });
  });

  describe('4. Candidate Application Pipeline & Tracking', () => {
    let applicationA;

    it('successfully tracks application for a job', async () => {
      const res = await request(app)
        .post('/api/applications')
        .set('Authorization', `Bearer ${tokenCandidateA}`)
        .send({
          jobId: testJob._id,
          status: 'applied',
          notes: 'Submitted via company website',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.application.status).toBe('applied');
      expect(res.body.data.application.jobId.title).toBe('Frontend Platform Engineer');

      applicationA = res.body.data.application;
    });

    it('prevents Candidate B from updating Candidate A application stage (BOLA isolation)', async () => {
      const res = await request(app)
        .patch(`/api/applications/${applicationA._id}`)
        .set('Authorization', `Bearer ${tokenCandidateB}`)
        .send({ status: 'rejected' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);

      const freshApp = await Application.findById(applicationA._id);
      expect(freshApp.status).toBe('applied');
    });

    it('allows Candidate A to update their own application status to interview', async () => {
      const res = await request(app)
        .patch(`/api/applications/${applicationA._id}`)
        .set('Authorization', `Bearer ${tokenCandidateA}`)
        .send({ status: 'interview', notes: 'First round technical scheduled' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.application.status).toBe('interview');
    });
  });

  describe('5. Candidate Dashboard & Profile Completeness', () => {
    it('returns candidate dashboard KPIs and AI-ranked matches', async () => {
      const res = await request(app)
        .get('/api/candidate/dashboard')
        .set('Authorization', `Bearer ${tokenCandidateA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stats).toBeDefined();
      expect(res.body.data.stats.totalApplications).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.data.topMatches)).toBe(true);
    });

    it('calculates profile completeness dynamically upon profile update', async () => {
      const res = await request(app)
        .put('/api/candidate/profile')
        .set('Authorization', `Bearer ${tokenCandidateA}`)
        .send({
          headline: 'Senior Full Stack Engineer',
          targetRoles: ['Staff Software Engineer', 'Full Stack Architect'],
          skills: [
            { name: 'TypeScript', proficiency: 'expert', yearsOfExperience: 6 },
            { name: 'React', proficiency: 'expert', yearsOfExperience: 6 },
            { name: 'Node.js', proficiency: 'advanced', yearsOfExperience: 5 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profile.completenessScore).toBeGreaterThanOrEqual(60);
    });
  });
});

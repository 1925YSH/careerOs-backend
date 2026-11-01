const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = require('../app');
const { connectDB, disconnectDB } = require('../config/db');
const env = require('../config/env');
const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const Resume = require('../models/Resume');
const Application = require('../models/Application');
const AgentTask = require('../models/AgentTask');
const Notification = require('../models/Notification');
const Company = require('../models/Company');
const Job = require('../models/Job');
const AuditLog = require('../models/AuditLog');

jest.setTimeout(30000);

describe('AI CareerOS - Phase 8 Security Hardening, OWASP ASVS & Data Privacy (DPDP/GDPR) Tests', () => {
  let candidateUser;
  let candidateToken;
  let companyUser;
  let companyToken;
  let testCompany;
  let testJob;
  let testResume;
  let testTask;

  beforeAll(async () => {
    await connectDB();
    const timestamp = Date.now();

    // 1. Create Candidate User
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('SecurePassword123!', salt);

    candidateUser = await User.create({
      email: `security-candidate-${timestamp}@careeros-test.io`,
      passwordHash,
      role: 'candidate',
      status: 'active',
      subscription: { plan: 'pro', status: 'active' },
    });

    candidateToken = jwt.sign(
      { id: candidateUser._id.toString(), role: 'candidate', email: candidateUser.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // 2. Create Candidate Profile, Resume, Task, and Notification
    await CandidateProfile.create({
      userId: candidateUser._id,
      name: 'Security Test Candidate',
      headline: 'Senior Full Stack Security Specialist',
      skills: [{ name: 'Node.js', proficiency: 'expert' }, { name: 'Cybersecurity', proficiency: 'advanced' }],
      targetRoles: ['Security Engineer', 'Fullstack Developer'],
    });

    testResume = await Resume.create({
      userId: candidateUser._id,
      fileName: 'test-security-resume.pdf',
      mimeType: 'application/pdf',
      size: 102400,
      s3Key: `resumes/${candidateUser._id}/security-test-key.pdf`,
      scanStatus: 'clean',
      isDefault: true,
      parsedContent: {
        skillsDetected: ['Node.js', 'Cybersecurity', 'Express.js'],
        experienceYears: 5,
      },
    });

    testTask = await AgentTask.create({
      userId: candidateUser._id,
      title: 'Review OWASP ASVS 5.0 Guidelines',
      category: 'interview_prep',
      priority: 'high',
      status: 'pending',
    });

    await Notification.create({
      userId: candidateUser._id,
      title: 'Security Alert',
      body: 'New login detected from verified test IP.',
      type: 'system_alert',
    });

    // 3. Create Company User & Job
    companyUser = await User.create({
      email: `security-company-${timestamp}@careeros-test.io`,
      passwordHash,
      role: 'company',
      status: 'active',
      subscription: { plan: 'starter', status: 'active' },
    });

    companyToken = jwt.sign(
      { id: companyUser._id.toString(), role: 'company', email: companyUser.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    testCompany = await Company.create({
      ownerUserId: companyUser._id,
      name: 'CyberDefense Technologies Corp',
      domain: `cyberdefense-${timestamp}.io`,
      careersUrl: `https://cyberdefense-${timestamp}.io/careers`,
      verified: true,
    });

    testJob = await Job.create({
      companyId: testCompany._id,
      title: 'Lead Security Operations Analyst',
      location: 'Bangalore, India',
      workMode: 'remote',
      employmentType: 'FULL_TIME',
      experienceMin: 4,
      experienceMax: 8,
      skills: ['Node.js', 'Cybersecurity'],
      salary: { min: 2500000, max: 4000000, currency: 'INR' },
      applicationUrl: `https://cyberdefense-${timestamp}.io/careers/sec-ops`,
      description: 'Defend AI systems against malicious prompt injections and parameter manipulation.',
      status: 'active',
    });

    // 4. Create an Application connecting candidate to company
    await Application.create({
      candidateId: candidateUser._id,
      jobId: testJob._id,
      companyId: testCompany._id,
      status: 'applied',
      notes: 'Strong candidate with automated testing background.',
    });
  });

  afterAll(async () => {
    // Cleanup any lingering records
    if (candidateUser) {
      await User.deleteMany({ email: candidateUser.email });
      await CandidateProfile.deleteMany({ userId: candidateUser._id });
      await Resume.deleteMany({ userId: candidateUser._id });
      await AgentTask.deleteMany({ userId: candidateUser._id });
      await Notification.deleteMany({ userId: candidateUser._id });
      await Application.deleteMany({ candidateId: candidateUser._id });
    }
    if (companyUser) {
      await User.deleteMany({ email: companyUser.email });
      await Company.deleteMany({ ownerUserId: companyUser._id });
      await Job.deleteMany({ companyId: testCompany?._id });
    }
    await disconnectDB();
  });

  describe('1. NoSQL Operator & Query Injection Defense (OWASP ASVS 5.0)', () => {
    it('1.1 should strip mongo query operators ($gt, $ne) from request body', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: { $gt: '' },
          password: { $ne: null },
        });

      // Since $gt and $ne are stripped by sanitizeNoSql, the validator or auth service receives invalid types
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('1.2 should neutralize $where and $regex injection payloads in query parameters', async () => {
      const res = await request(app)
        .get('/api/jobs')
        .query({
          title: { $regex: '.*' },
          role: { $where: 'sleep(5000)' },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('2. Stored XSS Sanitization & Parameter Pollution Defense', () => {
    it('2.1 should strip <script> and evil event handlers from user profile inputs', async () => {
      const maliciousHeadline =
        'Full Stack Engineer <script>alert("XSS")</script><img src=x onerror=alert(document.cookie)>';

      const res = await request(app)
        .put('/api/candidate/profile')
        .set('Cookie', [`token=${candidateToken}`])
        .send({
          headline: maliciousHeadline,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profile.headline).not.toContain('<script>');
      expect(res.body.data.profile.headline).not.toContain('onerror=');
      expect(res.body.data.profile.headline).toContain('Full Stack Engineer');
    });

    it('2.2 should handle HTTP Parameter Pollution gracefully', async () => {
      // Sending polluted array parameter for single-value field
      const res = await request(app)
        .get('/api/jobs')
        .query('page=1&page=2&limit=10');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('3. Data Privacy & Portability (India DPDP Act 2023 & GDPR Art. 15)', () => {
    it('3.1 should reject unauthenticated data export requests with 401', async () => {
      const res = await request(app).get('/api/users/export');
      expect(res.status).toBe(401);
    });

    it('3.2 should generate complete personal data archive in structured JSON for candidate', async () => {
      const res = await request(app)
        .get('/api/users/export')
        .set('Cookie', [`token=${candidateToken}`]);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['content-disposition']).toContain('attachment');

      const data = res.body;
      expect(data).toHaveProperty('exportMetadata');
      expect(data.exportMetadata.compliance).toContain('DPDP');
      expect(data.exportMetadata.userEmail).toBe(candidateUser.email);
      expect(data).toHaveProperty('account');
      expect(data.account.email).toBe(candidateUser.email);
      expect(data).toHaveProperty('candidateProfile');
      expect(data.candidateProfile.name).toBe('Security Test Candidate');
      expect(data).toHaveProperty('resumes');
      expect(Array.isArray(data.resumes)).toBe(true);
      expect(data.resumes.length).toBeGreaterThan(0);
      expect(data).toHaveProperty('applications');
      expect(Array.isArray(data.applications)).toBe(true);
      expect(data).toHaveProperty('careerSprintTasks');
      expect(Array.isArray(data.careerSprintTasks)).toBe(true);
      expect(data).toHaveProperty('notifications');
      expect(data).toHaveProperty('securityAuditTrail');
    });

    it('3.3 should record an immutable audit log entry when export is requested', async () => {
      const log = await AuditLog.findOne({
        actorId: candidateUser._id,
        action: 'DATA_EXPORT_REQUESTED',
      });
      expect(log).toBeDefined();
      expect(log.targetType).toBe('user');
    });
  });

  describe('4. Security Password Lifecycle Management', () => {
    it('4.1 should reject password update if current password is incorrect', async () => {
      const res = await request(app)
        .put('/api/users/password')
        .set('Cookie', [`token=${candidateToken}`])
        .send({
          currentPassword: 'WrongPassword123!',
          newPassword: 'BrandNewSecurePassword456!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('4.2 should reject password update if new password is too short (< 8 chars)', async () => {
      const res = await request(app)
        .put('/api/users/password')
        .set('Cookie', [`token=${candidateToken}`])
        .send({
          currentPassword: 'SecurePassword123!',
          newPassword: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('4.3 should update password hash with valid current credentials', async () => {
      const res = await request(app)
        .put('/api/users/password')
        .set('Cookie', [`token=${candidateToken}`])
        .send({
          currentPassword: 'SecurePassword123!',
          newPassword: 'BrandNewSecurePassword456!',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Password updated successfully');

      // Verify can login with new password
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: candidateUser.email,
          password: 'BrandNewSecurePassword456!',
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.success).toBe(true);
    });
  });

  describe('5. Irreversible Account Deletion & Right to Erasure Cascade (DPDP Act & GDPR Art. 17)', () => {
    it('5.1 should reject deletion without explicit confirmation string "DELETE"', async () => {
      const res = await request(app)
        .delete('/api/users/me')
        .set('Cookie', [`token=${candidateToken}`])
        .send({
          confirmation: 'PLEASE_DELETE',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('DELETE');
    });

    it('5.2 should cascade delete user, profile, resumes, tasks, notifications, and clear session cookie', async () => {
      const res = await request(app)
        .delete('/api/users/me')
        .set('Cookie', [`token=${candidateToken}`])
        .send({
          confirmation: 'DELETE',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('permanently erased');

      // Verify cookie cleared
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();

      // Verify database entities have been purged
      const user = await User.findById(candidateUser._id);
      expect(user).toBeNull();

      const profile = await CandidateProfile.findOne({ userId: candidateUser._id });
      expect(profile).toBeNull();

      const resumes = await Resume.find({ userId: candidateUser._id });
      expect(resumes.length).toBe(0);

      const tasks = await AgentTask.find({ userId: candidateUser._id });
      expect(tasks.length).toBe(0);

      const notifications = await Notification.find({ userId: candidateUser._id });
      expect(notifications.length).toBe(0);

      // Verify final audit record was preserved
      const audit = await AuditLog.findOne({
        targetId: candidateUser._id,
        action: 'USER_ACCOUNT_DELETED',
      });
      expect(audit).toBeDefined();
      expect(audit.metadata.compliance).toBe('DPDP_GDPR_RIGHT_TO_ERASURE');
    });

    it('5.3 should reject any further requests using token of deleted user with 401', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`token=${candidateToken}`]);

      expect(res.status).toBe(401);
    });
  });
});

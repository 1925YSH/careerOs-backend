const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../app');
const { connectDB, disconnectDB } = require('../config/db');
const env = require('../config/env');
const User = require('../models/User');
const Company = require('../models/Company');
const Job = require('../models/Job');
const CandidateProfile = require('../models/CandidateProfile');
const Resume = require('../models/Resume');
const AgentTask = require('../models/AgentTask');
const AuditLog = require('../models/AuditLog');
const {
  computeHybridJobMatch,
  evaluateDeterministicFit,
  evaluateSkillOverlap,
} = require('../services/match.service');
const {
  toolSearchJobs,
  toolGetUserProfile,
  toolCreateCareerTask,
  toolGenerateRoadmap,
} = require('../agent/agent.tools');

jest.setTimeout(25000);

describe('AI CareerOS - Phase 6 AI Career Agent & Match Intelligence Engine Tests', () => {
  let candidateUser;
  let companyUser;
  let testCompany;
  let testJobA;
  let testJobB;
  let candidateToken;
  let candidateProfile;
  let defaultResume;

  beforeAll(async () => {
    await connectDB();
    const timestamp = Date.now();

    // 1. Create Candidate User & Token
    candidateUser = await User.create({
      email: `candidate-agent-${timestamp}@test.com`,
      passwordHash: '$2b$12$dummyhashforphase6unittesting1234567890',
      role: 'candidate',
      status: 'active',
    });

    candidateToken = jwt.sign(
      { id: candidateUser._id.toString(), role: 'candidate', email: candidateUser.email },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // 2. Create Candidate Profile
    candidateProfile = await CandidateProfile.create({
      userId: candidateUser._id,
      name: 'Alex Rivera',
      headline: 'Senior Full Stack Engineer | Distributed Systems',
      location: 'San Francisco, CA',
      targetRoles: ['Staff Software Engineer', 'Senior Full Stack Engineer'],
      skills: [
        { name: 'TypeScript', proficiency: 'expert', yearsOfExperience: 5 },
        { name: 'Node.js', proficiency: 'expert', yearsOfExperience: 5 },
        { name: 'React', proficiency: 'expert', yearsOfExperience: 4 },
        { name: 'PostgreSQL', proficiency: 'intermediate', yearsOfExperience: 3 },
      ],
      experience: [
        {
          title: 'Software Engineer',
          company: 'Acme Cloud',
          location: 'San Francisco, CA',
          startDate: new Date('2021-01-01'),
          endDate: new Date('2025-01-01'),
          current: false,
          description: 'Built distributed APIs and React web applications.',
        },
      ],
      preferences: {
        salaryExpectationMin: 140000,
        salaryCurrency: 'USD',
        remotePreference: 'remote',
      },
      completenessScore: 85,
    });

    // 3. Create Default Resume with ATS Parsed Content
    defaultResume = await Resume.create({
      userId: candidateUser._id,
      s3Key: `resumes/${candidateUser._id}/test-resume.pdf`,
      fileName: 'Alex_Rivera_CV.pdf',
      mimeType: 'application/pdf',
      size: 1024 * 1024,
      scanStatus: 'clean',
      isDefault: true,
      parsedContent: {
        rawText: 'Senior Full Stack Engineer with 4 years building web services.',
        skillsDetected: ['typescript', 'node.js', 'react', 'postgresql', 'docker'],
        experienceYears: 4,
        summary: 'Experienced full stack engineer specializing in TypeScript and microservices.',
        missingSections: [],
        suggestions: ['Add AWS certification details'],
      },
    });

    // 4. Create Company
    companyUser = await User.create({
      email: `recruiter-${timestamp}@datacloud.test`,
      passwordHash: '$2b$12$dummyhashforphase6unittesting1234567890',
      role: 'company',
      status: 'active',
    });

    testCompany = await Company.create({
      name: `DataCloud Corp ${timestamp}`,
      domain: `datacloud${timestamp}.test`,
      ownerUserId: companyUser._id,
      verified: true,
    });

    // 5. Create Test Jobs
    // Job A: High Match (Remote, 3 yrs exp required, skills: typescript, node.js, react, docker)
    testJobA = await Job.create({
      companyId: testCompany._id,
      sourceType: 'company_posted',
      title: 'Senior TypeScript Architect',
      description: 'Design and scale cloud systems using TypeScript, Node.js, and React.',
      location: 'Remote',
      workMode: 'remote',
      employmentType: 'FULL_TIME',
      skills: ['typescript', 'node.js', 'react', 'docker'],
      experienceMin: 3,
      salary: { min: 150000, max: 190000, currency: 'USD', isDisclosed: true },
      status: 'active',
      applicationUrl: 'https://datacloud.test/careers/ts-architect',
      fingerprint: `fp_a_${timestamp}`,
    });

    // Job B: Lower Match (On-Site, 8 yrs exp required, skills: c++, rust, linux)
    testJobB = await Job.create({
      companyId: testCompany._id,
      sourceType: 'company_posted',
      title: 'Principal Systems Kernel Engineer',
      description: 'Low-level systems programming in Rust and C++.',
      location: 'New York, NY',
      workMode: 'on-site',
      employmentType: 'FULL_TIME',
      skills: ['c++', 'rust', 'linux', 'kernel'],
      experienceMin: 8,
      salary: { min: 180000, max: 220000, currency: 'USD', isDisclosed: true },
      status: 'active',
      applicationUrl: 'https://datacloud.test/careers/kernel-eng',
      fingerprint: `fp_b_${timestamp}`,
    });
  });

  afterAll(async () => {
    if (candidateUser) {
      await User.deleteMany({ _id: { $in: [candidateUser._id, companyUser._id] } });
      await CandidateProfile.deleteMany({ userId: candidateUser._id });
      await Resume.deleteMany({ userId: candidateUser._id });
      await AgentTask.deleteMany({ userId: candidateUser._id });
      await Company.deleteMany({ _id: testCompany._id });
      await Job.deleteMany({ companyId: testCompany._id });
      await AuditLog.deleteMany({ actorId: candidateUser._id });
    }
    await disconnectDB();
  });

  describe('1. Hybrid Match Intelligence Service', () => {
    it('evaluates deterministic factors accurately (experience, modality, compensation)', () => {
      // Test Job A: 3 yrs req, candidate has 4 yrs, remote aligns, salary meets expectation
      const detA = evaluateDeterministicFit(candidateUser, candidateProfile, defaultResume, testJobA);
      expect(detA.score).toBe(100);
      expect(detA.candidateYears).toBe(4);
      expect(detA.audit.every((a) => a.passed)).toBe(true);

      // Test Job B: 8 yrs req (deficit 4 yrs), on-site vs remote preference
      const detB = evaluateDeterministicFit(candidateUser, candidateProfile, defaultResume, testJobB);
      expect(detB.score).toBeLessThan(60);
      expect(detB.audit.some((a) => !a.passed)).toBe(true);
    });

    it('evaluates skill overlap and identifies matched competencies vs gaps', () => {
      // Job A skills: typescript, node.js, react, docker
      // Candidate skills: typescript, node.js, react, postgresql, docker
      const skillA = evaluateSkillOverlap(candidateProfile, defaultResume, testJobA);
      expect(skillA.score).toBe(100);
      expect(skillA.matchedSkills).toContain('typescript');
      expect(skillA.matchedSkills).toContain('docker');
      expect(skillA.missingSkills).toHaveLength(0);

      // Job B skills: c++, rust, linux, kernel
      const skillB = evaluateSkillOverlap(candidateProfile, defaultResume, testJobB);
      expect(skillB.score).toBeLessThan(30);
      expect(skillB.missingSkills).toContain('c++');
      expect(skillB.missingSkills).toContain('rust');
    });

    it('computes overall weighted hybrid match score and returns explainability breakdown', async () => {
      const matchA = await computeHybridJobMatch(candidateUser._id, testJobA._id);

      expect(matchA.overallScore).toBeGreaterThanOrEqual(85);
      expect(matchA.breakdown).toHaveProperty('deterministicFit');
      expect(matchA.breakdown).toHaveProperty('skillOverlap');
      expect(matchA.breakdown).toHaveProperty('contextualRationale');
      expect(matchA.breakdown.deterministicFit.weightPercent).toBe(40);
      expect(matchA.breakdown.skillOverlap.weightPercent).toBe(40);
      expect(matchA.breakdown.contextualRationale.weightPercent).toBe(20);
      expect(matchA.breakdown.contextualRationale.recommendation).toBeDefined();

      const matchB = await computeHybridJobMatch(candidateUser._id, testJobB._id);
      expect(matchB.overallScore).toBeLessThan(matchA.overallScore);
    });
  });

  describe('2. Career Agent Tool Sandbox', () => {
    it('executes toolSearchJobs with candidate filters and logs audit trail', async () => {
      const result = await toolSearchJobs(candidateUser._id, {
        query: 'TypeScript',
        workMode: 'remote',
        limit: 5,
      });

      expect(result.success).toBe(true);
      expect(result.jobs.length).toBeGreaterThanOrEqual(1);
      expect(result.jobs[0].title).toBe('Senior TypeScript Architect');

      // Verify audit log captured
      const log = await AuditLog.findOne({
        actorId: candidateUser._id,
        action: 'agent_tool_searchJobs',
      });
      expect(log).toBeDefined();
    });

    it('executes toolGetUserProfile and returns active resume diagnostics', async () => {
      const result = await toolGetUserProfile(candidateUser._id);
      expect(result.success).toBe(true);
      expect(result.profile.name).toBe('Alex Rivera');
      expect(result.profile.resume.skillsDetected).toContain('typescript');
      expect(result.profile.resume.experienceYears).toBe(4);
    });

    it('executes toolCreateCareerTask with due date validation', async () => {
      const result = await toolCreateCareerTask(candidateUser._id, {
        title: 'Review System Design for High-Throughput APIs',
        type: 'interview_prep',
        priority: 'high',
        dueInDays: 3,
      });

      expect(result.success).toBe(true);
      expect(result.task.title).toBe('Review System Design for High-Throughput APIs');
      expect(result.task.status).toBe('pending');
      expect(result.task.createdByAgent).toBe(true);

      const dbTask = await AgentTask.findById(result.task._id);
      expect(dbTask).toBeDefined();
    });

    it('executes toolGenerateRoadmap and generates full 7-day milestone sprint', async () => {
      const result = await toolGenerateRoadmap(candidateUser._id, {
        jobId: testJobA._id.toString(),
        targetRole: 'Senior TypeScript Architect',
      });

      expect(result.success).toBe(true);
      expect(result.roadmap.milestonesCount).toBe(7);
      expect(result.roadmap.tasks).toHaveLength(7);

      // Verify daily progression in DB
      const userTasks = await AgentTask.find({
        userId: candidateUser._id,
        'payload.milestoneDay': { $exists: true },
      }).sort({ 'payload.milestoneDay': 1 });

      expect(userTasks).toHaveLength(7);
      expect(userTasks[0].payload.milestoneDay).toBe(1);
      expect(userTasks[6].payload.milestoneDay).toBe(7);
    });
  });

  describe('3. Agent API Routes & Candidate Tasks Endpoints', () => {
    let createdTaskId;

    it('POST /api/agent/chat returns conversational response with suggested actions', async () => {
      const res = await request(app)
        .post('/api/agent/chat')
        .set('Cookie', [`token=${candidateToken}`])
        .send({ message: 'Find remote jobs with TypeScript' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toBeDefined();
      expect(Array.isArray(res.body.data.suggestedActions)).toBe(true);
      expect(res.body.data.suggestedActions.length).toBeGreaterThan(0);
    });

    it('POST /api/agent/match/:jobId returns transparent hybrid match breakdown', async () => {
      const res = await request(app)
        .post(`/api/agent/match/${testJobA._id}`)
        .set('Cookie', [`token=${candidateToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.match.overallScore).toBeGreaterThanOrEqual(80);
      expect(res.body.data.match.breakdown.deterministicFit).toBeDefined();
      expect(res.body.data.match.breakdown.skillOverlap).toBeDefined();
      expect(res.body.data.match.breakdown.contextualRationale).toBeDefined();
    });

    it('POST /api/agent/roadmap schedules 7-day sprint tasks', async () => {
      const res = await request(app)
        .post('/api/agent/roadmap')
        .set('Cookie', [`token=${candidateToken}`])
        .send({
          jobId: testJobA._id,
          targetRole: 'Senior TypeScript Architect',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.milestonesCount).toBe(7);
    });

    it('GET /api/agent/tasks lists all candidate tasks', async () => {
      const res = await request(app)
        .get('/api/agent/tasks')
        .set('Cookie', [`token=${candidateToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tasks.length).toBeGreaterThan(0);
      createdTaskId = res.body.data.tasks[0]._id;
    });

    it('PATCH /api/agent/tasks/:id updates task status to completed', async () => {
      const res = await request(app)
        .patch(`/api/agent/tasks/${createdTaskId}`)
        .set('Cookie', [`token=${candidateToken}`])
        .send({ status: 'completed' });

      expect(res.status).toBe(200);
      expect(res.body.data.task.status).toBe('completed');

      const updated = await AgentTask.findById(createdTaskId);
      expect(updated.status).toBe('completed');
    });

    it('DELETE /api/agent/tasks/:id removes task from candidate queue', async () => {
      const res = await request(app)
        .delete(`/api/agent/tasks/${createdTaskId}`)
        .set('Cookie', [`token=${candidateToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const deleted = await AgentTask.findById(createdTaskId);
      expect(deleted).toBeNull();
    });

    it('rejects unauthorized access without valid candidate token', async () => {
      const res = await request(app)
        .post('/api/agent/chat')
        .send({ message: 'Hello' });

      expect(res.status).toBe(401);
    });
  });
});


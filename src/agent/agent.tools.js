const { z } = require('zod');
const Job = require('../models/Job');
const CandidateProfile = require('../models/CandidateProfile');
const Application = require('../models/Application');
const AgentTask = require('../models/AgentTask');
const Resume = require('../models/Resume');
const AuditLog = require('../models/AuditLog');
const { computeHybridJobMatch } = require('../services/match.service');
const logger = require('../utils/logger');
const { ValidationError, NotFoundError } = require('../utils/errors');

/**
 * Audit log helper for tool executions (Section 10.3 Agent Safety)
 */
async function recordToolAudit(userId, toolName, input, result) {
  try {
    await AuditLog.create({
      actorId: userId,
      actorRole: 'candidate',
      action: `agent_tool_${toolName}`,
      targetType: 'system',
      metadata: {
        toolName,
        input: typeof input === 'object' ? input : { input },
        success: result.success !== false,
      },
    });
  } catch (err) {
    logger.warn('Failed to record agent tool audit log', { error: err.message });
  }
}

/**
 * 1. searchJobs: Search normalized active jobs with candidate preferences
 */
const searchJobsSchema = z.object({
  query: z.string().optional(),
  location: z.string().optional(),
  workMode: z.enum(['remote', 'hybrid', 'on-site', 'any']).optional(),
  limit: z.number().min(1).max(20).default(5),
});

async function toolSearchJobs(userId, args) {
  const validated = searchJobsSchema.parse(args || {});
  const filter = { status: 'active' };

  if (validated.query) {
    filter.$or = [
      { title: { $regex: validated.query.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), $options: 'i' } },
      { skills: { $regex: validated.query.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), $options: 'i' } },
    ];
  }

  if (validated.location) {
    filter.location = { $regex: validated.location.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), $options: 'i' };
  }

  if (validated.workMode && validated.workMode !== 'any') {
    filter.workMode = validated.workMode;
  }

  const jobs = await Job.find(filter)
    .populate('companyId', 'name domain logoUrl verified')
    .sort({ postedAt: -1 })
    .limit(validated.limit)
    .lean();

  const formatted = jobs.map((j) => ({
    jobId: j._id,
    title: j.title,
    company: j.companyId?.name || 'Verified Company',
    location: j.location,
    workMode: j.workMode,
    salary: j.salary?.isDisclosed ? `$${j.salary.min?.toLocaleString()} - $${j.salary.max?.toLocaleString()}` : 'Undisclosed',
    skills: j.skills || [],
    applicationUrl: j.applicationUrl,
  }));

  const res = { success: true, count: formatted.length, jobs: formatted };
  await recordToolAudit(userId, 'searchJobs', args, res);
  return res;
}

/**
 * 2. getJob: Read comprehensive job details
 */
const getJobSchema = z.object({
  jobId: z.string().min(1),
});

async function toolGetJob(userId, args) {
  const validated = getJobSchema.parse(args);
  const job = await Job.findById(validated.jobId)
    .populate('companyId', 'name domain description logoUrl verified careersUrl')
    .lean();

  if (!job) {
    throw new NotFoundError('Job listing not found');
  }

  const res = {
    success: true,
    job: {
      jobId: job._id,
      title: job.title,
      company: job.companyId?.name || 'Verified Company',
      domain: job.companyId?.domain,
      location: job.location,
      workMode: job.workMode,
      employmentType: job.employmentType,
      experienceMin: job.experienceMin,
      experienceMax: job.experienceMax,
      skills: job.skills,
      salary: job.salary,
      description: job.description,
      applicationUrl: job.applicationUrl,
      postedAt: job.postedAt,
    },
  };

  await recordToolAudit(userId, 'getJob', args, res);
  return res;
}

/**
 * 3. getUserProfile: Read candidate career profile & active resume summary
 */
async function toolGetUserProfile(userId) {
  const [profile, defaultResume] = await Promise.all([
    CandidateProfile.findOne({ userId }).lean(),
    Resume.findOne({ userId, isDefault: true }).lean(),
  ]);

  const res = {
    success: true,
    profile: {
      name: profile?.name || 'Candidate',
      headline: profile?.headline || 'Software Engineer',
      location: profile?.location || 'Remote',
      targetRoles: profile?.targetRoles || [],
      skills: profile?.skills || [],
      preferences: profile?.preferences || {},
      resume: defaultResume
        ? {
            fileName: defaultResume.fileName,
            parsedSummary: defaultResume.parsedContent?.summary,
            skillsDetected: defaultResume.parsedContent?.skillsDetected || [],
            experienceYears: defaultResume.parsedContent?.experienceYears || 0,
          }
        : null,
    },
  };

  await recordToolAudit(userId, 'getUserProfile', {}, res);
  return res;
}

/**
 * 4. analyzeJobFit: Perform transparent hybrid match breakdown
 */
const analyzeJobFitSchema = z.object({
  jobId: z.string().min(1),
});

async function toolAnalyzeJobFit(userId, args) {
  const validated = analyzeJobFitSchema.parse(args);
  const matchResult = await computeHybridJobMatch(userId, validated.jobId);

  const res = {
    success: true,
    match: matchResult,
  };

  await recordToolAudit(userId, 'analyzeJobFit', args, res);
  return res;
}

/**
 * 5. createCareerTask: Create preparation or follow-up item in candidate workspace
 */
const createCareerTaskSchema = z.object({
  title: z.string().min(3).max(200),
  type: z.enum(['interview_prep', 'resume_update', 'skill_learning', 'application_followup', 'general']).default('interview_prep'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueInDays: z.number().min(0).max(30).default(3),
  payload: z.record(z.any()).optional(),
});

async function toolCreateCareerTask(userId, args) {
  const validated = createCareerTaskSchema.parse(args);

  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + validated.dueInDays);

  const task = await AgentTask.create({
    userId,
    title: validated.title,
    type: validated.type,
    priority: validated.priority,
    dueAt,
    payload: validated.payload || {},
    status: 'pending',
    createdByAgent: true,
  });

  const res = {
    success: true,
    message: 'Career task successfully scheduled',
    task,
  };

  await recordToolAudit(userId, 'createCareerTask', args, res);
  return res;
}

/**
 * 6. generateRoadmap: Builds a customized 7-day interview milestone roadmap
 */
const generateRoadmapSchema = z.object({
  jobId: z.string().optional(),
  targetRole: z.string().optional(),
});

async function toolGenerateRoadmap(userId, args) {
  const validated = generateRoadmapSchema.parse(args || {});

  let targetTitle = validated.targetRole || 'Senior Engineer';
  let companyName = 'Target Employer';
  let missingCompetencies = ['Distributed Systems', 'System Design'];

  if (validated.jobId) {
    const job = await Job.findById(validated.jobId).populate('companyId', 'name');
    if (job) {
      targetTitle = job.title;
      companyName = job.companyId?.name || companyName;

      // Extract match details to customize milestones
      try {
        const match = await computeHybridJobMatch(userId, job._id);
        if (match.breakdown?.skillOverlap?.missingSkills?.length > 0) {
          missingCompetencies = match.breakdown.skillOverlap.missingSkills.slice(0, 3);
        }
      } catch {}
    }
  }

  // Generate 7-day structured milestone plan
  const milestones = [
    {
      day: 1,
      title: `Day 1: Role Fundamentals & Tech Stack Deep-Dive (${targetTitle})`,
      desc: `Review core architectural foundations and specific library lifecycles for ${companyName}.`,
      type: 'interview_prep',
      priority: 'high',
      dueInDays: 1,
    },
    {
      day: 2,
      title: `Day 2: Data Structures & High-Efficiency Algorithms`,
      desc: 'Practice 2-3 medium complexity problems on arrays, tree traversals, and dynamic caching.',
      type: 'interview_prep',
      priority: 'medium',
      dueInDays: 2,
    },
    {
      day: 3,
      title: `Day 3: Address Critical Skill Gaps (${missingCompetencies.join(', ')})`,
      desc: `Build a quick hands-on benchmark demonstrating mastery of ${missingCompetencies.join(' and ')}.`,
      type: 'skill_learning',
      priority: 'urgent',
      dueInDays: 3,
    },
    {
      day: 4,
      title: 'Day 4: Large-Scale System Design & Database Partitioning',
      desc: 'Draft an architectural diagram for a real-time event pipeline with horizontal sharding & Redis caching.',
      type: 'interview_prep',
      priority: 'high',
      dueInDays: 4,
    },
    {
      day: 5,
      title: `Day 5: Behavioral STAR Framework & ${companyName} Culture Alignment`,
      desc: 'Prepare 4 concrete project conflict and leadership stories aligned with company leadership principles.',
      type: 'interview_prep',
      priority: 'medium',
      dueInDays: 5,
    },
    {
      day: 6,
      title: 'Day 6: Mock Interview Simulation & Live Coding Rehearsal',
      desc: 'Conduct a 45-minute timed coding sprint explaining algorithmic complexity out loud.',
      type: 'interview_prep',
      priority: 'high',
      dueInDays: 6,
    },
    {
      day: 7,
      title: 'Day 7: Reverse Inquiries & Final Strategic Checklist',
      desc: 'Formulate 3 strategic reverse questions for hiring managers regarding team scalability and architecture.',
      type: 'application_followup',
      priority: 'high',
      dueInDays: 7,
    },
  ];

  // Batch insert into candidate tasks
  const createdTasks = await Promise.all(
    milestones.map((m) => {
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + m.dueInDays);

      return AgentTask.create({
        userId,
        title: m.title,
        type: m.type,
        priority: m.priority,
        dueAt,
        payload: {
          milestoneDay: m.day,
          description: m.desc,
          targetRole: targetTitle,
          companyName,
        },
        status: 'pending',
        createdByAgent: true,
      });
    })
  );

  const res = {
    success: true,
    roadmap: {
      targetRole: targetTitle,
      company: companyName,
      milestonesCount: createdTasks.length,
      tasks: createdTasks,
    },
  };

  await recordToolAudit(userId, 'generateRoadmap', args, res);
  return res;
}

/**
 * 7. getApplications: Read candidate application status
 */
async function toolGetApplications(userId) {
  const applications = await Application.find({ candidateId: userId })
    .populate('jobId', 'title location workMode salary status')
    .populate('companyId', 'name domain verified')
    .sort({ updatedAt: -1 })
    .lean();

  const res = {
    success: true,
    count: applications.length,
    applications: applications.map((a) => ({
      applicationId: a._id,
      jobTitle: a.jobId?.title || 'Job Listing',
      company: a.companyId?.name || 'Company',
      status: a.status,
      notes: a.notes,
      appliedAt: a.createdAt,
    })),
  };

  await recordToolAudit(userId, 'getApplications', {}, res);
  return res;
}

/**
 * 8. updateApplication: Change candidate application status (e.g. Applied -> Interview)
 */
const updateApplicationSchema = z.object({
  applicationId: z.string().min(1),
  status: z.enum(['saved', 'applied', 'reviewing', 'interview', 'offer', 'rejected', 'withdrawn']),
  notes: z.string().optional(),
});

async function toolUpdateApplication(userId, args) {
  const validated = updateApplicationSchema.parse(args);
  const application = await Application.findOne({
    _id: validated.applicationId,
    candidateId: userId,
  });

  if (!application) {
    throw new NotFoundError('Application not found or unauthorized');
  }

  application.status = validated.status;
  if (validated.notes) application.notes = validated.notes;
  await application.save();

  const res = {
    success: true,
    message: `Application updated to '${validated.status}'`,
    application,
  };

  await recordToolAudit(userId, 'updateApplication', args, res);
  return res;
}

module.exports = {
  toolSearchJobs,
  toolGetJob,
  toolGetUserProfile,
  toolAnalyzeJobFit,
  toolCreateCareerTask,
  toolGenerateRoadmap,
  toolGetApplications,
  toolUpdateApplication,
};


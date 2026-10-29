const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const CandidateProfile = require('../models/CandidateProfile');
const Application = require('../models/Application');
const Job = require('../models/Job');
const Resume = require('../models/Resume');
const AgentTask = require('../models/AgentTask');
const { NotFoundError, ValidationError } = require('../utils/errors');

const router = express.Router();

// All candidate routes require authenticated candidate
router.use(authenticate, requireRole('candidate'));

/**
 * Helper to calculate candidate profile completeness score
 */
function calculateCompleteness(profile) {
  let score = 20; // Base score for registered user with name

  if (profile.headline && profile.headline.trim()) score += 15;
  if (profile.targetRoles && profile.targetRoles.length > 0) score += 15;
  if (profile.skills && profile.skills.length >= 3) score += 25;
  else if (profile.skills && profile.skills.length > 0) score += 10;
  if (profile.experience && profile.experience.length > 0) score += 15;
  if (profile.preferences && (profile.preferences.minSalary || profile.preferences.workMode?.length > 0)) {
    score += 10;
  }

  return Math.min(100, score);
}

/**
 * GET /api/candidate/dashboard - Candidate daily command center KPIs & matching feed
 */
router.get('/dashboard', async (req, res, next) => {
  try {
    let profile = await CandidateProfile.findOne({ userId: req.user._id });
    if (!profile) {
      profile = await CandidateProfile.create({
        userId: req.user._id,
        name: req.user.email.split('@')[0],
        completenessScore: 20,
      });
    }

    const [
      savedCount,
      activeAppsCount,
      totalAppsCount,
      tasksCount,
      recentApplications,
      activeJobs,
      latestResume,
    ] = await Promise.all([
      Application.countDocuments({ candidateId: req.user._id, status: 'saved' }),
      Application.countDocuments({
        candidateId: req.user._id,
        status: { $in: ['applied', 'reviewing', 'interview'] },
      }),
      Application.countDocuments({ candidateId: req.user._id }),
      AgentTask.countDocuments({ candidateId: req.user._id, status: 'pending' }).catch(() => 0),
      Application.find({ candidateId: req.user._id })
        .populate('jobId', 'title location workMode salary status')
        .populate('companyId', 'name domain logoUrl verified')
        .sort({ updatedAt: -1 })
        .limit(5)
        .lean(),
      Job.find({ status: 'active' })
        .populate('companyId', 'name domain logoUrl verified')
        .sort({ postedAt: -1 })
        .limit(6)
        .lean(),
      Resume.findOne({ userId: req.user._id, isDefault: true }).lean(),
    ]);

    // Rank jobs based on candidate skill overlap
    const candidateSkillNames = profile.skills.map((s) => s.name.toLowerCase());
    const scoredJobs = activeJobs.map((job) => {
      const jobSkills = (job.skills || []).map((s) => s.toLowerCase());
      const matched = jobSkills.filter((s) => candidateSkillNames.includes(s));
      const matchScore =
        jobSkills.length > 0
          ? Math.round((matched.length / jobSkills.length) * 100)
          : 75; // Default baseline if job has no explicit skills

      return {
        ...job,
        matchScore: Math.max(65, Math.min(98, matchScore || 70)),
        matchedSkills: matched,
        missingSkills: jobSkills.filter((s) => !candidateSkillNames.includes(s)),
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        profile,
        stats: {
          recommendedMatches: activeJobs.length,
          savedJobs: savedCount,
          activeApplications: activeAppsCount,
          totalApplications: totalAppsCount,
          tasksDue: tasksCount || 2, // 2 default guidance tasks
        },
        topMatches: scoredJobs.sort((a, b) => b.matchScore - a.matchScore),
        recentApplications,
        latestResume: latestResume || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/candidate/profile - Retrieve candidate profile
 */
router.get('/profile', async (req, res, next) => {
  try {
    let profile = await CandidateProfile.findOne({ userId: req.user._id }).lean();
    if (!profile) {
      profile = await CandidateProfile.create({
        userId: req.user._id,
        name: req.user.email.split('@')[0],
        completenessScore: 20,
      });
    }

    return res.status(200).json({
      success: true,
      data: { profile },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/candidate/profile - Update candidate profile
 */
router.put('/profile', async (req, res, next) => {
  try {
    let profile = await CandidateProfile.findOne({ userId: req.user._id });
    if (!profile) {
      profile = new CandidateProfile({ userId: req.user._id, name: req.user.email.split('@')[0] });
    }

    const { name, headline, location, targetRoles, skills, experience, preferences } = req.body;

    if (name) profile.name = name.trim();
    if (headline !== undefined) profile.headline = headline.trim();
    if (location !== undefined) profile.location = location.trim();
    if (Array.isArray(targetRoles)) profile.targetRoles = targetRoles;
    if (Array.isArray(skills)) profile.skills = skills;
    if (Array.isArray(experience)) profile.experience = experience;
    if (preferences) profile.preferences = preferences;

    profile.completenessScore = calculateCompleteness(profile);
    await profile.save();

    return res.status(200).json({
      success: true,
      data: { profile },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;


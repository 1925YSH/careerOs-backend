const Job = require('../models/Job');
const CandidateProfile = require('../models/CandidateProfile');
const Resume = require('../models/Resume');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

// In-memory match cache to avoid redundant calculations and LLM token costs
// Key: `${candidateId}:${jobId}:${resumeVersion || 'no-resume'}`
const matchCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Calculates deterministic qualification factor (Weight: 40%)
 * Evaluates hard prerequisites: experience bounds, work modality, and minimum compensation
 */
function evaluateDeterministicFit(candidate, profile, resume, job) {
  let score = 100;
  const audit = [];

  // 1. Experience Years Evaluation
  const candidateYears =
    resume?.parsedContent?.experienceYears ??
    profile?.experience?.reduce((acc, exp) => {
      if (exp.startDate) {
        const end = exp.endDate ? new Date(exp.endDate) : new Date();
        const start = new Date(exp.startDate);
        const diffYears = (end - start) / (1000 * 60 * 60 * 24 * 365.25);
        return acc + Math.max(0, diffYears);
      }
      return acc;
    }, 0) ??
    0;

  const roundedYears = Math.round(candidateYears * 10) / 10;

  if (job.experienceMin && job.experienceMin > 0) {
    if (roundedYears >= job.experienceMin) {
      audit.push({
        factor: 'Experience Level',
        passed: true,
        message: `${roundedYears} yrs experience meets or exceeds required minimum of ${job.experienceMin} yrs.`,
      });
    } else {
      const deficit = job.experienceMin - roundedYears;
      const penalty = Math.min(40, Math.round(deficit * 15));
      score -= penalty;
      audit.push({
        factor: 'Experience Level',
        passed: false,
        message: `Role requires ${job.experienceMin} yrs minimum experience (Candidate has ~${roundedYears} yrs).`,
      });
    }
  } else {
    audit.push({
      factor: 'Experience Level',
      passed: true,
      message: 'No minimum experience strictly required for this listing.',
    });
  }

  // 2. Work Modality Evaluation
  const candidatePref = profile?.preferences?.remotePreference || 'any';
  const jobMode = job.workMode || 'on-site';

  if (candidatePref === 'any' || candidatePref === jobMode) {
    audit.push({
      factor: 'Work Modality',
      passed: true,
      message: `Work mode '${jobMode}' aligns with candidate preference '${candidatePref}'.`,
    });
  } else if (candidatePref === 'remote' && jobMode !== 'remote') {
    score -= 25;
    audit.push({
      factor: 'Work Modality',
      passed: false,
      message: `Candidate prefers Remote roles, but this role is ${jobMode}.`,
    });
  } else {
    score -= 10;
    audit.push({
      factor: 'Work Modality',
      passed: true,
      message: `Modality: ${jobMode}. Candidate preferred: ${candidatePref}.`,
    });
  }

  // 3. Compensation Expectation Baseline
  const minExpected = profile?.preferences?.salaryExpectationMin;
  if (minExpected && job.salary && job.salary.isDisclosed && job.salary.max) {
    if (job.salary.max >= minExpected) {
      audit.push({
        factor: 'Compensation Alignment',
        passed: true,
        message: `Offered salary range up to $${job.salary.max.toLocaleString()} meets minimum expectation of $${minExpected.toLocaleString()}.`,
      });
    } else {
      score -= 20;
      audit.push({
        factor: 'Compensation Alignment',
        passed: false,
        message: `Max compensation offered ($${job.salary.max.toLocaleString()}) is below candidate expectation ($${minExpected.toLocaleString()}).`,
      });
    }
  }

  return {
    score: Math.max(10, Math.min(100, score)),
    candidateYears: roundedYears,
    audit,
  };
}

/**
 * Calculates Competency & Skill Overlap factor (Weight: 40%)
 */
function evaluateSkillOverlap(profile, resume, job) {
  const profileSkills = (profile?.skills || []).map((s) => s.name.toLowerCase().trim());
  const resumeSkills = (resume?.parsedContent?.skillsDetected || []).map((s) => s.toLowerCase().trim());

  // Unified candidate competency set
  const candidateSkillSet = new Set([...profileSkills, ...resumeSkills]);

  const jobSkills = (job.skills || []).map((s) => s.toLowerCase().trim());

  if (jobSkills.length === 0) {
    return {
      score: 80,
      matchedSkills: Array.from(candidateSkillSet).slice(0, 5),
      missingSkills: [],
      matchRatio: 1.0,
    };
  }

  const matchedSkills = [];
  const missingSkills = [];

  for (const skill of jobSkills) {
    if (candidateSkillSet.has(skill)) {
      matchedSkills.push(skill);
    } else {
      // Fuzzy substring matching (e.g. "react.js" vs "react", "postgresql" vs "postgres")
      const fuzzyMatch = Array.from(candidateSkillSet).some(
        (cs) => cs.includes(skill) || skill.includes(cs)
      );
      if (fuzzyMatch) {
        matchedSkills.push(skill);
      } else {
        missingSkills.push(skill);
      }
    }
  }

  const matchRatio = matchedSkills.length / jobSkills.length;
  const score = Math.round(matchRatio * 100);

  return {
    score: Math.max(15, Math.min(100, score)),
    matchedSkills,
    missingSkills,
    matchRatio,
  };
}

/**
 * Generates Contextual AI Rationale (Weight: 20%) via Gemini 1.5 Flash
 */
async function generateAiRationale(candidateData, job) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return generateFallbackRationale(candidateData, job);
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `You are the explainability engine of AI CareerOS. Analyze this match between a candidate and a verified job opening.
Return ONLY valid JSON with no markdown backticks or commentary.

Candidate:
- Headline: ${candidateData.headline || 'Software Engineer'}
- Years of Experience: ${candidateData.experienceYears}
- Matched Competencies: ${candidateData.matchedSkills.join(', ') || 'General engineering background'}
- Missing Skills: ${candidateData.missingSkills.join(', ') || 'None identified'}

Job Listing:
- Title: ${job.title}
- Company: ${job.companyId?.name || 'Verified Company'}
- Modality: ${job.workMode}
- Description excerpt: ${(job.description || '').slice(0, 500)}

JSON Schema:
{
  "contextualScore": number (between 50 and 100),
  "strengths": ["bullet point 1", "bullet point 2"],
  "gaps": ["bullet point 1"],
  "recommendation": "1-2 sentence concise actionable guidance for the candidate"
}
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      score: Math.max(50, Math.min(100, parsed.contextualScore || 75)),
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : ['Strong technical foundation matching core requirements.'],
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps : ['Expand portfolio projects demonstrating target domain.'],
      recommendation: parsed.recommendation || 'Focus your interview preparation on real-world system architecture tradeoffs.',
    };
  } catch (err) {
    logger.warn('Gemini Match Rationale generation fallback triggered', { error: err.message });
    return generateFallbackRationale(candidateData, job);
  }
}

/**
 * Deterministic Fallback Rationale when offline or testing
 */
function generateFallbackRationale(candidateData, job) {
  const strengths = [];
  const gaps = [];

  if (candidateData.matchedSkills.length > 0) {
    strengths.push(`Direct alignment on ${candidateData.matchedSkills.slice(0, 3).join(', ')}.`);
  } else {
    strengths.push('Adaptable foundational background across modern software paradigms.');
  }

  if (candidateData.experienceYears >= (job.experienceMin || 0)) {
    strengths.push(`Experience level (~${candidateData.experienceYears} yrs) satisfies hiring team standards.`);
  }

  if (candidateData.missingSkills.length > 0) {
    gaps.push(`Familiarity with ${candidateData.missingSkills.slice(0, 2).join(' and ')} would strengthen conversion.`);
  }

  return {
    score: 80,
    strengths,
    gaps: gaps.length > 0 ? gaps : ['No critical disqualifying skill gaps identified.'],
    recommendation: `Highlight hands-on production impact with ${candidateData.matchedSkills.slice(0, 2).join(' & ') || 'your primary stack'} in your application notes.`,
  };
}

/**
 * Master Hybrid Match Function
 * Combines:
 * - 40% Deterministic Hard Fit
 * - 40% Skill & Competency Overlap
 * - 20% Contextual AI Rationale
 *
 * @param {string} userId - Candidate User ID
 * @param {string} jobId - Job ID
 * @returns {Promise<object>} Match analysis envelope
 */
async function computeHybridJobMatch(userId, jobId) {
  // Check in-memory cache
  const cacheKey = `${userId}:${jobId}`;
  const cached = matchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const [job, profile, defaultResume] = await Promise.all([
    Job.findById(jobId).populate('companyId', 'name domain logoUrl verified'),
    CandidateProfile.findOne({ userId }),
    Resume.findOne({ userId, isDefault: true }),
  ]);

  if (!job) {
    throw new Error('Target job listing not found or expired.');
  }

  // 1. Deterministic Fit (40%)
  const deterministic = evaluateDeterministicFit(null, profile, defaultResume, job);

  // 2. Skill Overlap (40%)
  const skillFit = evaluateSkillOverlap(profile, defaultResume, job);

  // 3. Contextual AI Rationale (20%)
  const candidateData = {
    headline: profile?.headline,
    experienceYears: deterministic.candidateYears,
    matchedSkills: skillFit.matchedSkills,
    missingSkills: skillFit.missingSkills,
  };
  const aiRationale = await generateAiRationale(candidateData, job);

  // Overall Weighted Score calculation
  // Overall = 0.40 * Deterministic + 0.40 * SkillOverlap + 0.20 * Contextual
  const weightedScore = Math.round(
    0.4 * deterministic.score +
    0.4 * skillFit.score +
    0.2 * aiRationale.score
  );

  const finalScore = Math.max(25, Math.min(99, weightedScore));

  const result = {
    jobId: job._id,
    jobTitle: job.title,
    company: {
      name: job.companyId?.name || 'Verified Company',
      domain: job.companyId?.domain,
      verified: job.companyId?.verified || false,
    },
    overallScore: finalScore,
    breakdown: {
      deterministicFit: {
        score: deterministic.score,
        weightPercent: 40,
        candidateYears: deterministic.candidateYears,
        requiredYears: job.experienceMin || 0,
        audit: deterministic.audit,
      },
      skillOverlap: {
        score: skillFit.score,
        weightPercent: 40,
        matchedSkills: skillFit.matchedSkills,
        missingSkills: skillFit.missingSkills,
        matchRatio: skillFit.matchRatio,
      },
      contextualRationale: {
        score: aiRationale.score,
        weightPercent: 20,
        strengths: aiRationale.strengths,
        gaps: aiRationale.gaps,
        recommendation: aiRationale.recommendation,
      },
    },
    calculatedAt: new Date(),
  };

  // Cache result
  matchCache.set(cacheKey, {
    data: result,
    timestamp: Date.now(),
  });

  return result;
}

/**
 * Clears match cache for a candidate (e.g. when new resume is uploaded or profile updated)
 */
function invalidateCandidateMatchCache(userId) {
  const prefix = `${userId}:`;
  for (const key of matchCache.keys()) {
    if (key.startsWith(prefix)) {
      matchCache.delete(key);
    }
  }
}

module.exports = {
  computeHybridJobMatch,
  evaluateDeterministicFit,
  evaluateSkillOverlap,
  generateAiRationale,
  invalidateCandidateMatchCache,
};


const { GoogleGenerativeAI } = require('@google/generative-ai');
const tools = require('./agent.tools');
const logger = require('../utils/logger');

/**
 * Handles conversational queries and orchestrates tool executions
 * Enforces Section 10.3 Least Privilege and prompt-injection safety
 */
async function processAgentMessage(userId, messageText, context = {}) {
  const query = (messageText || '').toLowerCase().trim();

  // 1. Deterministic Intent Routing & Tool Execution (works reliably online & offline)
  let toolResult = null;
  let responseText = '';
  let suggestedActions = [];

  try {
    // Intent: Roadmap Generation
    if (query.includes('roadmap') || query.includes('7-day') || query.includes('interview prep')) {
      const roadmapResult = await tools.toolGenerateRoadmap(userId, {
        jobId: context.jobId,
        targetRole: context.targetRole || 'Full Stack Engineer',
      });
      toolResult = { tool: 'generateRoadmap', data: roadmapResult };
      responseText = `I have generated your customized **7-Day Interview Sprint Roadmap** for **${roadmapResult.roadmap.targetRole}** at **${roadmapResult.roadmap.company}**! 

All 7 daily milestone tasks have been automatically scheduled in your **Career Tasks** pipeline:
- **Day 1**: Role Fundamentals & Architecture
- **Day 2**: Data Structures & Performance Algorithms
- **Day 3**: Critical Skill-Gap Remediation
- **Day 4**: System Design & Distributed Partitioning
- **Day 5**: Behavioral STAR Framework Preparation
- **Day 6**: Mock Interview & Timed Coding
- **Day 7**: Strategic Reverse Inquiries for the Hiring Team

You can review and mark each milestone complete right here or from your Command Center.`;
      suggestedActions = [
        'View my active career tasks',
        'Analyze my fit for another role',
        'Find jobs with >80% match',
      ];
    }
    // Intent: Analyze Job Fit
    else if ((query.includes('fit') || query.includes('match') || query.includes('analyze')) && (context.jobId || query.includes('job'))) {
      const jobId = context.jobId;
      if (jobId) {
        const fitResult = await tools.toolAnalyzeJobFit(userId, { jobId });
        toolResult = { tool: 'analyzeJobFit', data: fitResult };
        const match = fitResult.match;
        responseText = `**Match Analysis: ${match.overallScore}% Compatibility** for **${match.jobTitle}** at **${match.company.name}**:

* **Deterministic Hard Requirements (40% Weight)**: ${match.breakdown.deterministicFit.score}%
  - ${match.breakdown.deterministicFit.audit[0]?.message || 'Experience level aligned'}
* **Skill Overlap (40% Weight)**: ${match.breakdown.skillOverlap.score}%
  - **Matched**: ${match.breakdown.skillOverlap.matchedSkills.join(', ') || 'Core tech stack'}
  - **Identified Gaps**: ${match.breakdown.skillOverlap.missingSkills.join(', ') || 'None'}
* **AI Rationale (20% Weight)**:
  - *Recommendation*: ${match.breakdown.contextualRationale.recommendation}`;

        suggestedActions = [
          'Generate 7-Day Interview Roadmap for this job',
          'Add to Application Tracker',
          'Explore similar open roles',
        ];
      } else {
        // Search first then offer to analyze
        const jobs = await tools.toolSearchJobs(userId, { limit: 3 });
        toolResult = { tool: 'searchJobs', data: jobs };
        responseText = `Here are the top active listings in your field. Tell me which one you would like me to analyze in detail:
${jobs.jobs.map((j, i) => `${i + 1}. **${j.title}** at **${j.company}** (${j.workMode}, ${j.location})`).join('\n')}`;
        suggestedActions = jobs.jobs.map((j) => `Analyze fit for ${j.title}`);
      }
    }
    // Intent: Search / Find Jobs
    else if (query.includes('search') || query.includes('find') || query.includes('job') || query.includes('roles')) {
      const isRemote = query.includes('remote');
      const jobs = await tools.toolSearchJobs(userId, {
        workMode: isRemote ? 'remote' : 'any',
        limit: 5,
      });
      toolResult = { tool: 'searchJobs', data: jobs };
      responseText = `I discovered **${jobs.count} verified job opportunities** matching your preferences:

${jobs.jobs
  .map(
    (j, i) =>
      `${i + 1}. **${j.title}** — *${j.company}* (${j.workMode} • ${j.location})  \n   Salary: ${j.salary} | Skills: ${j.skills.slice(0, 3).join(', ')}`
  )
  .join('\n\n')}`;

      suggestedActions = [
        'Analyze my fit for the first role',
        'Find remote-only positions',
        'Check my profile skill gaps',
      ];
    }
    // Intent: Check Applications
    else if (query.includes('application') || query.includes('applied') || query.includes('pipeline')) {
      const apps = await tools.toolGetApplications(userId);
      toolResult = { tool: 'getApplications', data: apps };
      if (apps.count === 0) {
        responseText = `You currently have 0 active tracked applications in your pipeline. Would you like me to find verified high-match roles to apply to?`;
        suggestedActions = ['Find jobs with >80% match', 'Review my ATS resume'];
      } else {
        responseText = `You have **${apps.count} tracked application(s)** in your pipeline:

${apps.applications
  .map(
    (a, i) =>
      `${i + 1}. **${a.jobTitle}** at **${a.company}** — Stage: \`${a.status.toUpperCase()}\``
  )
  .join('\n')}`;
        suggestedActions = [
          'Generate interview prep for active application',
          'Search for new opportunities',
        ];
      }
    }
    // Intent: Profile & Skills Overview
    else if (query.includes('skill') || query.includes('profile') || query.includes('resume')) {
      const profileData = await tools.toolGetUserProfile(userId);
      toolResult = { tool: 'getUserProfile', data: profileData };
      const p = profileData.profile;
      responseText = `**Career Profile Overview for ${p.name}**:
- **Headline**: ${p.headline}
- **Location**: ${p.location}
- **Recorded Skills**: ${p.skills.map((s) => s.name).join(', ') || 'No skills added yet'}
- **Active ATS Resume**: ${p.resume ? `${p.resume.fileName} (~${p.resume.experienceYears} yrs experience)` : 'No default resume set'}

Would you like me to identify skill gaps against current market listings or schedule interview preparation tasks?`;
      suggestedActions = [
        'Identify high-impact skill gaps',
        'Find jobs with >80% match',
        'Generate 7-day interview sprint',
      ];
    }
    // Fallback Conversational Response
    else {
      responseText = `I am your AI Career Agent. I have secure, authorized access to your candidate workspace to assist you with:
- **Transparent Match Scoring**: Explaining exactly why you match (or miss) specific job openings.
- **7-Day Interview Roadmaps**: Generating customized daily milestone preparation tasks.
- **Job Discovery & Application Tracking**: Querying verified employer listings and tracking your pipeline.

What would you like to work on next?`;
      suggestedActions = [
        'Find jobs matching my skills',
        'Generate a 7-day interview roadmap',
        'Analyze my profile fit',
      ];
    }

    return {
      success: true,
      message: responseText,
      toolInvocations: toolResult ? [toolResult] : [],
      suggestedActions,
      timestamp: new Date(),
    };
  } catch (err) {
    logger.error('Agent Engine processing error', { error: err.message, query });
    return {
      success: false,
      message: `I encountered an issue processing your request: ${err.message}. Please try again or select one of the suggested actions below.`,
      toolInvocations: [],
      suggestedActions: [
        'Find jobs with >80% match',
        'Generate a 7-day interview sprint',
        'Review my career profile',
      ],
      timestamp: new Date(),
    };
  }
}

module.exports = {
  processAgentMessage,
};


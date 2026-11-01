const crypto = require('crypto');
const { URL } = require('url');
const Job = require('../models/Job');
const logger = require('../utils/logger');

/**
 * Normalizes text string for deterministic hashing
 * Lowercase, remove excess whitespace and non-alphanumeric punctuation
 * @param {string} str
 * @returns {string}
 */
function normalizeString(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/gi, '')
    .replace(/\s+/g, ' ');
}

/**
 * Generates cryptographic SHA-256 fingerprint for a job listing
 * @param {string} companyDomain
 * @param {string} title
 * @param {string} location
 * @returns {string} SHA-256 hex digest
 */
function generateJobFingerprint(companyDomain, title, location) {
  const normDomain = normalizeString(companyDomain);
  const normTitle = normalizeString(title);
  const normLoc = normalizeString(location);

  const rawKey = `${normDomain}:${normTitle}:${normLoc}`;
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Deduplicates and upserts an ingested job
 * If fingerprint already exists in the database, updates lastSeenAt and sourceAttribution.
 * If new, creates a new active Job record.
 * @param {object} params
 * @param {object} params.jobData
 * @param {object} params.company
 * @param {object} params.source
 * @returns {Promise<{ isDuplicate: boolean, action: 'created'|'updated', job: object }>}
 */
async function deduplicateAndUpsert({ jobData, company, source }) {
  let domain = company.domain;
  if (!domain && source.careersUrl) {
    try {
      domain = new URL(source.careersUrl).hostname;
    } catch {
      domain = 'unknown';
    }
  }

  const fingerprint = generateJobFingerprint(domain, jobData.title, jobData.location);

  // Check for existing job with matching fingerprint
  const existingJob = await Job.findOne({ fingerprint });

  if (existingJob) {
    existingJob.lastSeenAt = new Date();
    if (!existingJob.sourceAttribution) {
      existingJob.sourceAttribution = {};
    }
    existingJob.sourceAttribution.lastCheckedAt = new Date();
    existingJob.sourceAttribution.domain = domain;
    existingJob.sourceAttribution.verifiedSource = true;

    // Reactivate if it was previously archived but is still listed on the career site
    if (existingJob.status === 'archived') {
      existingJob.status = 'active';
    }

    await existingJob.save();

    logger.info('Duplicate job detected during ingestion, updated freshness timestamp', {
      jobId: existingJob._id,
      title: existingJob.title,
      fingerprint,
    });

    return {
      isDuplicate: true,
      action: 'updated',
      job: existingJob,
    };
  }

  // Create new ingested job
  const newJob = await Job.create({
    companyId: company._id,
    sourceType: 'ingested',
    sourceUrl: source.careersUrl,
    applicationUrl: jobData.applicationUrl || source.careersUrl,
    fingerprint,
    title: jobData.title,
    description: jobData.description || jobData.title,
    location: jobData.location || 'Remote',
    workMode: jobData.workMode || 'on-site',
    employmentType: jobData.employmentType || 'FULL_TIME',
    skills: jobData.skills || [],
    experienceMin: jobData.experienceMin || 0,
    experienceMax: jobData.experienceMax,
    salary: jobData.salary || { isDisclosed: false, currency: 'USD' },
    status: 'active',
    sourceAttribution: {
      domain,
      verifiedSource: true,
      lastCheckedAt: new Date(),
    },
    postedAt: jobData.postedAt || new Date(),
    lastSeenAt: new Date(),
  });

  logger.info('New verified job created from ingestion source', {
    jobId: newJob._id,
    title: newJob.title,
    fingerprint,
  });

  return {
    isDuplicate: false,
    action: 'created',
    job: newJob,
  };
}

module.exports = {
  normalizeString,
  generateJobFingerprint,
  deduplicateAndUpsert,
};


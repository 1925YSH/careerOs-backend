const JobSource = require('../models/JobSource');
const IngestionRun = require('../models/IngestionRun');
const { safeFetch } = require('./fetcher');
const { parseJobPage } = require('./parser');
const { deduplicateAndUpsert } = require('./dedupe');
const logger = require('../utils/logger');
const { ValidationError } = require('../utils/errors');

/**
 * Runs the end-to-end ingestion pipeline for a single JobSource
 * Pipeline: Fetch -> Clean -> Parse -> Validate -> Dedupe -> Persist -> Record Metrics
 * @param {string} sourceId
 * @returns {Promise<object>} Completed IngestionRun
 */
async function runIngestionForSource(sourceId) {
  const source = await JobSource.findById(sourceId).populate('companyId');
  if (!source) {
    throw new ValidationError(`JobSource with id '${sourceId}' not found.`);
  }

  const startTime = Date.now();
  const run = await IngestionRun.create({
    sourceId: source._id,
    startedAt: new Date(startTime),
    status: 'running',
    counts: {
      fetched: 0,
      candidateJobs: 0,
      extracted: 0,
      rejected: 0,
      duplicates: 0,
      created: 0,
      updated: 0,
    },
    errors: [],
  });

  try {
    logger.info('Starting ingestion run', {
      runId: run._id,
      sourceId: source._id,
      careersUrl: source.careersUrl,
    });

    // Step 1: HTTP Fetch with SSRF Defense & Allowed Domains Check
    let fetchResult;
    try {
      fetchResult = await safeFetch(source.careersUrl, source.allowedDomains);
      run.counts.fetched += 1;
    } catch (fetchErr) {
      run.errors.push({
        stage: 'fetch',
        message: fetchErr.message,
        timestamp: new Date(),
      });
      throw fetchErr;
    }

    // Step 2: Clean & Parse (JSON-LD -> Semantic HTML -> AI fallback)
    let candidateJobs = [];
    try {
      candidateJobs = await parseJobPage(fetchResult.html, source.careersUrl, source.parserStrategy);
      run.counts.candidateJobs = candidateJobs.length;
      run.counts.extracted = candidateJobs.length;
    } catch (parseErr) {
      run.errors.push({
        stage: 'parse',
        message: parseErr.message,
        timestamp: new Date(),
      });
    }

    // Step 3: Validate, Deduplicate and Upsert
    const company = source.companyId;
    for (const jobItem of candidateJobs) {
      try {
        // Business Validation
        if (!jobItem.title || jobItem.title.trim().length < 2) {
          run.counts.rejected += 1;
          continue;
        }

        const result = await deduplicateAndUpsert({
          jobData: jobItem,
          company,
          source,
        });

        if (result.action === 'created') {
          run.counts.created += 1;
        } else if (result.action === 'updated') {
          run.counts.updated += 1;
          run.counts.duplicates += 1;
        }
      } catch (upsertErr) {
        run.counts.rejected += 1;
        run.errors.push({
          stage: 'dedupe_upsert',
          message: upsertErr.message,
          timestamp: new Date(),
        });
      }
    }

    // Step 4: Finalize Run State & Update Source Health
    const durationMs = Date.now() - startTime;
    run.durationMs = durationMs;
    run.finishedAt = new Date();

    if (run.errors.length === 0) {
      run.status = 'success';
      source.consecutiveFailures = 0;
      source.lastError = undefined;
      source.lastSuccessAt = new Date();
    } else if (run.counts.created > 0 || run.counts.updated > 0) {
      run.status = 'partial';
      source.lastSuccessAt = new Date();
    } else {
      run.status = 'failed';
      source.consecutiveFailures = (source.consecutiveFailures || 0) + 1;
      source.lastError = run.errors[0]?.message || 'Ingestion completed with 0 jobs extracted';
    }

    source.lastRunAt = new Date();
    // Schedule next run
    const intervalHours = source.crawlIntervalHours || 24;
    source.nextRunAt = new Date(Date.now() + intervalHours * 60 * 60 * 1000);

    await Promise.all([run.save(), source.save()]);

    logger.info('Completed ingestion run', {
      runId: run._id,
      status: run.status,
      durationMs,
      counts: run.counts,
    });

    return run;
  } catch (fatalErr) {
    const durationMs = Date.now() - startTime;
    run.durationMs = durationMs;
    run.finishedAt = new Date();
    run.status = 'failed';
    if (!run.errors.some((e) => e.message === fatalErr.message)) {
      run.errors.push({
        stage: 'pipeline_fatal',
        message: fatalErr.message,
        timestamp: new Date(),
      });
    }

    source.consecutiveFailures = (source.consecutiveFailures || 0) + 1;
    source.lastError = fatalErr.message;
    source.lastRunAt = new Date();
    // Exponential backoff or default 6 hours on error
    source.nextRunAt = new Date(Date.now() + 6 * 60 * 60 * 1000);

    await Promise.all([run.save(), source.save()]);

    logger.error('Fatal failure in ingestion run', {
      runId: run._id,
      sourceId: source._id,
      error: fatalErr.message,
    });

    return run;
  }
}

module.exports = {
  runIngestionForSource,
};


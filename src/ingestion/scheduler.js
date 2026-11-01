const cron = require('node-cron');
const JobSource = require('../models/JobSource');
const { runIngestionForSource } = require('./runner');
const logger = require('../utils/logger');

let scheduledTask = null;
let isRunning = false;

/**
 * Executes a crawl cycle across all active sources that are due for ingestion
 */
async function processDueSources() {
  if (isRunning) {
    logger.info('Ingestion cycle already in progress, skipping duplicate cycle');
    return;
  }

  isRunning = true;
  try {
    const now = new Date();
    const dueSources = await JobSource.find({
      active: true,
      permissionStatus: 'approved',
      $or: [{ nextRunAt: { $lte: now } }, { nextRunAt: null }, { lastRunAt: null }],
    });

    if (dueSources.length === 0) {
      logger.info('Ingestion scheduler: No sources due for crawl at this time');
      isRunning = false;
      return;
    }

    logger.info(`Ingestion scheduler: Found ${dueSources.length} due source(s) to process`);

    for (const source of dueSources) {
      try {
        await runIngestionForSource(source._id);
      } catch (err) {
        logger.error(`Error processing source ${source._id}: ${err.message}`);
      }
    }
  } catch (err) {
    logger.error('Error during scheduled ingestion run cycle', { error: err.message });
  } finally {
    isRunning = false;
  }
}

/**
 * Initializes the background node-cron scheduler
 * Defaults to hourly checks (at minute 0)
 * @param {string} cronPattern
 */
function initScheduler(cronPattern = '0 * * * *') {
  if (scheduledTask) {
    scheduledTask.stop();
  }

  scheduledTask = cron.schedule(cronPattern, async () => {
    logger.info('Cron trigger: Starting due job sources ingestion cycle');
    await processDueSources();
  });

  logger.info(`Job Ingestion Scheduler initialized with schedule: ${cronPattern}`);
}

/**
 * Stops the scheduled cron worker
 */
function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('Job Ingestion Scheduler stopped');
  }
}

/**
 * Manually triggers an immediate ingestion run for a single source
 * @param {string} sourceId
 */
async function triggerIngestionNow(sourceId) {
  return await runIngestionForSource(sourceId);
}

/**
 * Triggers an immediate crawl across all approved active sources
 */
async function runAllActiveSources() {
  const activeSources = await JobSource.find({
    active: true,
    permissionStatus: 'approved',
  });

  const results = [];
  for (const source of activeSources) {
    try {
      const run = await runIngestionForSource(source._id);
      results.push({ sourceId: source._id, success: true, runId: run._id, counts: run.counts });
    } catch (err) {
      results.push({ sourceId: source._id, success: false, error: err.message });
    }
  }
  return results;
}

module.exports = {
  initScheduler,
  stopScheduler,
  processDueSources,
  triggerIngestionNow,
  runAllActiveSources,
};


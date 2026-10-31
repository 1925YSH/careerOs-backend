const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const { processAgentMessage } = require('../agent/agent.engine');
const { computeHybridJobMatch } = require('../services/match.service');
const { toolGenerateRoadmap } = require('../agent/agent.tools');
const AgentTask = require('../models/AgentTask');
const { NotFoundError, ValidationError } = require('../utils/errors');

const router = express.Router();

// Strict RBAC: All agent capabilities require authenticated candidate session
router.use(authenticate, requireRole('candidate'));

/**
 * POST /api/agent/chat - Conversational career agent with tool execution
 */
router.post('/chat', aiLimiter, async (req, res, next) => {
  try {
    const { message, context } = req.body;

    if (!message || typeof message !== 'string') {
      throw new ValidationError('Message content is required.');
    }

    const response = await processAgentMessage(req.user._id, message, context || {});
    return res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agent/match/:jobId - Compute transparent hybrid match fit
 */
router.post('/match/:jobId', aiLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const match = await computeHybridJobMatch(req.user._id, jobId);

    return res.status(200).json({
      success: true,
      data: { match },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agent/roadmap - Generate 7-day interview milestone tasks
 */
router.post('/roadmap', aiLimiter, async (req, res, next) => {
  try {
    const { jobId, targetRole } = req.body;
    const result = await toolGenerateRoadmap(req.user._id, { jobId, targetRole });

    return res.status(201).json({
      success: true,
      message: '7-Day Interview Sprint generated and scheduled into your task pipeline.',
      data: result.roadmap,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/agent/tasks - Candidate task list (filtered by status)
 */
router.get('/tasks', async (req, res, next) => {
  try {
    const { status } = req.query;
    const filter = { userId: req.user._id };

    if (status && status !== 'all') {
      filter.status = status;
    }

    const tasks = await AgentTask.find(filter)
      .sort({ dueAt: 1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        count: tasks.length,
        tasks,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/agent/tasks/:id - Update task status (e.g. pending -> completed)
 */
router.patch('/tasks/:id', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      throw new ValidationError("Status must be one of: 'pending', 'in_progress', 'completed', 'cancelled'");
    }

    const task = await AgentTask.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!task) {
      throw new NotFoundError('Career task not found');
    }

    task.status = status;
    await task.save();

    return res.status(200).json({
      success: true,
      message: `Task marked as '${status}'`,
      data: { task },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/agent/tasks/:id - Remove task from candidate queue
 */
router.delete('/tasks/:id', async (req, res, next) => {
  try {
    const task = await AgentTask.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!task) {
      throw new NotFoundError('Career task not found');
    }

    return res.status(200).json({
      success: true,
      message: 'Task removed successfully.',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

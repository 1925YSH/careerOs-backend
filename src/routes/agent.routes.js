const express = require('express');
const { authenticate } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.use(authenticate, aiLimiter);

/**
 * POST /api/agent/chat - Conversational career agent
 */
router.post('/chat', async (req, res, next) => {
  try {
    const { message, conversationId } = req.body;

    return res.status(200).json({
      success: true,
      data: {
        conversationId: conversationId || 'conv_' + Date.now(),
        message: 'Career Agent initialized. Ready to assist with job search, match analysis, and interview planning.',
        suggestedActions: [
          'Find jobs with >80% match',
          'Analyze my resume fit for recent jobs',
          'Create a 7-day interview prep roadmap',
        ],
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;


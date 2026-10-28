const app = require('./app');
const env = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const logger = require('./utils/logger');

let server;

async function startServer() {
  await connectDB();

  server = app.listen(env.PORT, () => {
    logger.info(`🚀 AI CareerOS API Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
    logger.info(`🔗 CORS configured for Client URL: ${env.CLIENT_URL}`);
  });

  // Graceful shutdown handlers
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    if (server) {
      server.close(async () => {
        logger.info('HTTP server closed.');
        await disconnectDB();
        process.exit(0);
      });
    } else {
      process.exit(0);
    }

    // Force exit after 10 seconds if hanging
    setTimeout(() => {
      logger.error('Forcing shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  logger.error('Failed to start server:', { error: err.message, stack: err.stack });
  process.exit(1);
});


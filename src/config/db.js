const mongoose = require('mongoose');
const logger = require('../utils/logger');
const env = require('./env');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(env.MONGODB_URI, {
      autoIndex: env.NODE_ENV !== 'production', // Build indexes on startup only in dev/test
      serverSelectionTimeoutMS: 5000,
    });

    logger.info(`MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', { error: err.message });
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting reconnection...');
    });

    return conn;
  } catch (error) {
    logger.error('Failed to connect to MongoDB:', { error: error.message });
    if (env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
};

const disconnectDB = async () => {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed.');
};

module.exports = { connectDB, disconnectDB };


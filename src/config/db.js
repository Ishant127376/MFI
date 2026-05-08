'use strict';

/**
 * db.js
 * Establishes and exposes the Mongoose connection to MongoDB.
 * The connection string is read exclusively from the MONGODB_URI environment
 * variable — never hardcoded here.
 */

const mongoose = require('mongoose');
const { MONGODB_URI } = require('./env');
const logger = require('../utils/logger');

/**
 * Connect to MongoDB.
 * Called once at server startup (see app.js).
 * Mongoose handles internal reconnection automatically.
 */
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      // useNewUrlParser and useUnifiedTopology are defaults in Mongoose ≥ 6,
      // but listed here for clarity.
      serverSelectionTimeoutMS: 10000, // fail fast in CI / bad configs
    });
    logger.info('[db] MongoDB connection established');
  } catch (err) {
    logger.error('[db] MongoDB connection failed', { message: err.message });
    // Hard exit — there is no meaningful server operation without a DB.
    process.exit(1);
  }
}

/**
 * Returns the current Mongoose connection state as a human-readable string.
 * Used by the /health endpoint.
 *
 * readyState values (from Mongoose docs):
 *   0 = disconnected
 *   1 = connected
 *   2 = connecting
 *   3 = disconnecting
 */
function getConnectionState() {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  return states[mongoose.connection.readyState] || 'unknown';
}

module.exports = { connectDB, getConnectionState };

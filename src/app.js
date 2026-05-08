'use strict';

/**
 * app.js
 * Application entry point for the OES Apple MFi Software Authentication Server.
 *
 * Startup sequence:
 *   1. Load + validate environment variables (config/env.js — hard fails if any missing)
 *   2. Load Apple MFi server certificate from disk (apple.auth.js)
 *   3. Connect to MongoDB (config/db.js — exits if connection fails)
 *   4. Start Express server
 *
 * If any step 1–3 fails, the process exits with a non-zero code.
 * There is no partial start — the server is either fully ready or not running.
 */

// Step 1 — env validation (throws synchronously if any variable is missing)
const env = require('./config/env');

const express = require('express');
const { connectDB } = require('./config/db');
const { loadAppleCert } = require('./services/apple/apple.auth');
const routes = require('./routes/index');
const loggerMiddleware = require('./middleware/logger.middleware');
const errorMiddleware  = require('./middleware/error.middleware');
const logger = require('./utils/logger');

const app = express();

// ─── Global middleware ────────────────────────────────────────────────────────

// Parse JSON request bodies.
app.use(express.json());

// HTTP request logging (does NOT log request body — see logger.middleware.js).
app.use(loggerMiddleware);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/v1', routes);

// 404 handler for unknown routes.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────
// Must be registered after all routes.
app.use(errorMiddleware);

// ─── Server startup ───────────────────────────────────────────────────────────

async function start() {
  try {
    // Step 2 — Load Apple certificate (throws if file missing or unreadable).
    // Comment this out during local development if you do not yet have the cert.
    // The server will still start but Apple API calls will fail.
    //
    // TODO [cert-setup]: Uncomment once Apple MFi certificate is issued.
    //      Submit a CSR through the Apple MFi Portal, receive the cert,
    //      store it at the path defined by APPLE_CERT_PATH in .env.
    //
    // loadAppleCert();

    logger.warn(
      '[app] Apple MFi certificate loading is SKIPPED — ' +
      'uncomment loadAppleCert() in app.js once certificate is obtained from Apple MFi Portal'
    );

    // Step 3 — Connect to MongoDB.
    await connectDB();

    // Step 4 — Start HTTP server.
    const server = app.listen(env.PORT, () => {
      logger.info(`[app] OES Auth Server listening on port ${env.PORT}`, {
        nodeEnv: env.NODE_ENV,
        ppid:    env.PPID,
      });
    });

    // ── Graceful shutdown ──────────────────────────────────────────────────
    const shutdown = (signal) => {
      logger.info(`[app] ${signal} received — shutting down gracefully`);
      server.close(() => {
        logger.info('[app] HTTP server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (err) {
    logger.error('[app] Fatal startup error', { message: err.message, stack: err.stack });
    process.exit(1);
  }
}

start();

module.exports = app; // exported for test imports

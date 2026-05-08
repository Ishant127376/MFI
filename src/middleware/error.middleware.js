'use strict';

/**
 * error.middleware.js
 * Global Express error handler.
 *
 * Must be registered LAST in app.js (after all routes) so it catches errors
 * thrown or passed via next(err) from any route handler or middleware.
 *
 * Distinguishes between:
 *   - NOT_IMPLEMENTED stubs   → 501
 *   - Mongoose validation errors → 400
 *   - All other errors           → 500
 *
 * SECURITY: Stack traces are only included in development mode.
 * tokenData is never in an error object — redaction step in logger provides
 * a secondary safeguard, but controllers must not attach raw tokens to errors.
 */

const logger = require('../utils/logger');
const { sendError, ERROR_CODES } = require('../utils/response');
const { NODE_ENV } = require('../config/env');

// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, next) {
  // ── NOT IMPLEMENTED stubs ────────────────────────────────────────────────
  if (err.message && err.message.startsWith('NOT IMPLEMENTED')) {
    logger.warn('[error] NOT IMPLEMENTED stub called', {
      path: req.path,
      method: req.method,
      stubMessage: err.message,
    });
    return sendError(
      res,
      501,
      ERROR_CODES.NOT_IMPLEMENTED,
      err.message
    );
  }

  // ── Mongoose validation errors ───────────────────────────────────────────
  if (err.name === 'ValidationError') {
    logger.warn('[error] Mongoose ValidationError', { path: req.path, error: err.message });
    return sendError(res, 400, ERROR_CODES.INVALID_INPUT, err.message);
  }

  // ── Mongoose duplicate key (e.g. uuid conflict) ──────────────────────────
  if (err.code === 11000) {
    logger.warn('[error] Duplicate key error', { path: req.path });
    return sendError(res, 409, ERROR_CODES.DB_ERROR, 'Duplicate key constraint violated');
  }

  // ── Generic server errors ────────────────────────────────────────────────
  logger.error('[error] Unhandled server error', {
    path: req.path,
    method: req.method,
    message: err.message,
    // Only expose stack in development to avoid leaking internals.
    ...(NODE_ENV !== 'production' && { stack: err.stack }),
  });

  return sendError(res, 500, ERROR_CODES.DB_ERROR, 'Internal server error');
}

module.exports = errorMiddleware;

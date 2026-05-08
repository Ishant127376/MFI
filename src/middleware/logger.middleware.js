'use strict';

/**
 * logger.middleware.js
 * HTTP request/response logging middleware.
 *
 * Logs every incoming request and its corresponding response status code.
 * Uses the application Winston logger (utils/logger.js) which already has
 * the tokenData redaction transform applied.
 *
 * Fields logged per request:
 *   method, path, ip, statusCode, durationMs
 *
 * Fields intentionally NOT logged:
 *   - Request body    (may contain device serial in /provision — log at
 *                      controller level with explicit field selection)
 *   - Response body   (may contain tokenData in /provision response)
 *   - Auth headers    (x-api-key must never appear in logs)
 */

const logger = require('../utils/logger');

function loggerMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error'
                : res.statusCode >= 400 ? 'warn'
                : 'info';

    logger[level](`[http] ${req.method} ${req.path}`, {
      method:     req.method,
      path:       req.path,
      statusCode: res.statusCode,
      durationMs,
      ip:         req.ip,
    });
  });

  next();
}

module.exports = loggerMiddleware;

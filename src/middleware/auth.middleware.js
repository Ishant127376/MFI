'use strict';

/**
 * auth.middleware.js
 * API key authentication middleware.
 *
 * Two key tiers:
 *   ADMIN_API_KEY  — required for privileged operations:
 *                    POST /api/v1/tokens/pull
 *                    POST /api/v1/register
 *                    GET  /api/v1/tokens/stats
 *
 *   DEVICE_API_KEY — required for device provisioning:
 *                    POST /api/v1/provision
 *
 * Keys are read exclusively from environment variables (loaded by config/env.js).
 * They MUST NOT be hardcoded here or anywhere else.
 *
 * The API key must be passed in the `x-api-key` request header.
 */

const { ADMIN_API_KEY, DEVICE_API_KEY } = require('../config/env');
const { sendError, ERROR_CODES } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * Builds a middleware that validates the `x-api-key` header against an
 * expected key value read from the environment.
 *
 * @param {string} expectedKey  - The env-sourced key to compare against
 * @param {string} tierLabel    - Human-readable label for logging (e.g. 'admin')
 * @returns {import('express').RequestHandler}
 */
function requireApiKey(expectedKey, tierLabel) {
  return function (req, res, next) {
    const provided = req.headers['x-api-key'];

    if (!provided) {
      logger.warn(`[auth] Missing x-api-key header — ${tierLabel} route`, {
        path: req.path,
        ip: req.ip,
      });
      return sendError(res, 401, ERROR_CODES.INVALID_API_KEY, 'API key required');
    }

    // Constant-time comparison is ideal to prevent timing attacks.
    // For MVP / internal use, direct comparison is acceptable; upgrade to
    // crypto.timingSafeEqual if the server is exposed to the public internet.
    if (provided !== expectedKey) {
      logger.warn(`[auth] Invalid ${tierLabel} API key`, {
        path: req.path,
        ip: req.ip,
      });
      return sendError(res, 403, ERROR_CODES.INVALID_API_KEY, 'Invalid API key');
    }

    next();
  };
}

const requireAdminKey  = requireApiKey(ADMIN_API_KEY,  'admin');
const requireDeviceKey = requireApiKey(DEVICE_API_KEY, 'device');

module.exports = { requireAdminKey, requireDeviceKey };

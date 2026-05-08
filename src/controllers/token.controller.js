'use strict';

/**
 * token.controller.js
 * HTTP layer for token-related endpoints:
 *
 *   POST /api/v1/tokens/pull    — pull a batch from Apple (stub)
 *   POST /api/v1/register       — register a UUID with Apple (stub)
 *   GET  /api/v1/tokens/stats   — live token counts from MongoDB
 *   GET  /api/v1/health         — server + DB liveness check
 */

const { sendSuccess, sendError, ERROR_CODES } = require('../utils/response');
const {
  pullAndStoreTokens,
  markRegistered,
  getTokenStats,
} = require('../services/token/token.service');
const { registerTokensWithApple } = require('../services/apple/apple.register');
const { getConnectionState } = require('../config/db');
const logger = require('../utils/logger');

// ─── POST /api/v1/tokens/pull ─────────────────────────────────────────────────

/**
 * Triggers a pull of a token batch from Apple's token API and stores them
 * in MongoDB.
 *
 * Currently blocked on the Apple Server Specification — will throw
 * NOT IMPLEMENTED via apple.tokens.js.  The error middleware converts
 * this to a 501 response automatically.
 */
async function pullTokens(req, res, next) {
  try {
    const count = await pullAndStoreTokens();
    return sendSuccess(res, 200, { tokensStored: count }, 'Token batch pulled and stored');
  } catch (err) {
    logger.error('[token.controller] pullTokens error', { message: err.message });
    next(err);
  }
}

// ─── POST /api/v1/register ───────────────────────────────────────────────────

/**
 * Registers a batch of provisioned tokens with Apple and transitions them to
 * REGISTERED state in MongoDB.
 *
 * Request body:
 *   {
 *     "ppid": "215445-000027",
 *     "tokenUuidMap": [
 *       { "tokenId": "A9CC9E9E1B2B4CA1A2962E49D6640C04", "uuid": "61d053e9-c8d4-48be-b60d-7da5abb6d3d6" },
 *       { "tokenId": "B682BE93218C443686E5FD4BD045F6AD", "uuid": "0ca04fe6-fc15-45e9-b473-329670a7ae41" }
 *     ]
 *   }
 */
async function registerToken(req, res, next) {
  try {
    const { ppid, tokenUuidMap } = req.body;

    // Validate ppid
    if (!ppid || typeof ppid !== 'string' || ppid.trim() === '') {
      return sendError(res, 400, ERROR_CODES.INVALID_INPUT, '"ppid" is required');
    }

    // Validate tokenUuidMap is non-empty array
    if (!Array.isArray(tokenUuidMap) || tokenUuidMap.length === 0) {
      return sendError(res, 400, ERROR_CODES.INVALID_INPUT, '"tokenUuidMap" must be a non-empty array');
    }

    // Validate each entry has tokenId and uuid
    for (const entry of tokenUuidMap) {
      if (!entry.tokenId || typeof entry.tokenId !== 'string' || entry.tokenId.trim() === '') {
        return sendError(res, 400, ERROR_CODES.INVALID_INPUT, 'Each entry must have a non-empty "tokenId"');
      }
      if (!entry.uuid || typeof entry.uuid !== 'string' || entry.uuid.trim() === '') {
        return sendError(res, 400, ERROR_CODES.INVALID_INPUT, 'Each entry must have a non-empty "uuid"');
      }
    }

    logger.info('Register request received', { ppid, tokenCount: tokenUuidMap.length });

    // Call bulk registration service
    const result = await registerTokensWithApple(ppid.trim(), tokenUuidMap);

    logger.info('Registration complete', { ppid, registered: result.registered, failed: result.failed });

    return sendSuccess(
      res,
      200,
      {
        registered: result.registered,
        failed: result.failed,
        failedTokenIds: result.failedTokenIds,
        failedReasons: result.failedReasons,
      },
      'Tokens registered successfully'
    );
  } catch (err) {
    logger.error('Registration controller error', { error: err.message });
    next(err);
  }
}

// ─── GET /api/v1/tokens/stats ─────────────────────────────────────────────────

/**
 * Returns per-status token counts from a live MongoDB aggregation query.
 * No hardcoded numbers.
 */
async function getStats(req, res, next) {
  try {
    const stats = await getTokenStats();
    return sendSuccess(res, 200, { stats }, 'Token stats fetched');
  } catch (err) {
    logger.error('[token.controller] getStats error', { message: err.message });
    next(err);
  }
}

// ─── GET /api/v1/health ───────────────────────────────────────────────────────

/**
 * Liveness check.  No authentication required.
 * Reports real MongoDB connection state and server uptime.
 */
async function health(req, res) {
  const dbState = getConnectionState();

  return sendSuccess(
    res,
    dbState === 'connected' ? 200 : 503,
    {
      status:   dbState === 'connected' ? 'ok' : 'degraded',
      db:       dbState,
      uptimeSeconds: Math.floor(process.uptime()),
      nodeEnv:  process.env.NODE_ENV,
    },
    'Health check'
  );
}

module.exports = { pullTokens, registerToken, getStats, health };

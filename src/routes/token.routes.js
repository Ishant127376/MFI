'use strict';

/**
 * token.routes.js
 * Route definitions for token management and server health endpoints.
 *
 *   POST /api/v1/tokens/pull   — pull token batch from Apple (admin key required)
 *   GET  /api/v1/tokens/stats  — live status counts from DB (admin key required)
 *   POST /api/v1/register      — register UUID with Apple (admin key required)
 *   GET  /api/v1/health        — liveness check (no auth)
 */

const { Router } = require('express');
const { requireAdminKey } = require('../middleware/auth.middleware');
const { pullTokens, registerToken, getStats, health } = require('../controllers/token.controller');

const router = Router();

// Pull a batch of tokens from Apple's token API and store in MongoDB.
// Currently returns 501 — blocked on Apple Server Specification.
router.post('/tokens/pull', requireAdminKey, pullTokens);

// Live token counts per status from MongoDB aggregation.
router.get('/tokens/stats', requireAdminKey, getStats);

// Register a provisioned UUID with Apple.
// Currently returns 501 — blocked on Apple Server Specification.
router.post('/register', requireAdminKey, registerToken);

// Liveness / health check — no authentication required.
router.get('/health', health);

module.exports = router;

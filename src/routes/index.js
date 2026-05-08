'use strict';

/**
 * routes/index.js
 * Central route aggregator.  Mounts all route modules under the /api/v1 prefix.
 *
 * Adding a new route group:
 *   1. Create a new file in src/routes/.
 *   2. Import it here.
 *   3. Mount it with router.use(newRouter).
 */

const { Router } = require('express');
const tokenRoutes     = require('./token.routes');
const provisionRoutes = require('./provision.routes');

const router = Router();

router.use(tokenRoutes);
router.use(provisionRoutes);

module.exports = router;

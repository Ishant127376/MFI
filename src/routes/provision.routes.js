'use strict';

/**
 * provision.routes.js
 * Route definition for the factory provisioning endpoint.
 *
 *   POST /api/v1/provision   — provision a token onto a device (device key required)
 *
 * This endpoint is called exactly once per physical OES device during factory
 * flashing.  A second call from the same device serial is rejected with
 * DEVICE_ALREADY_PROVISIONED (HTTP 409).
 *
 * Authentication: DEVICE_API_KEY (lower-privilege key embedded in firmware images)
 */

const { Router } = require('express');
const { requireDeviceKey } = require('../middleware/auth.middleware');
const { provision } = require('../controllers/provision.controller');

const router = Router();

router.post('/provision', requireDeviceKey, provision);

module.exports = router;

'use strict';

/**
 * provision.controller.js
 * HTTP layer for the factory provisioning endpoint:
 *
 *   POST /api/v1/provision
 *
 * Called by the factory flashing station once per physical OES device.
 * A device that calls this endpoint a second time is rejected with
 * DEVICE_ALREADY_PROVISIONED.
 *
 * Request body:
 *   { "deviceSerial": "<hardware serial number of device being flashed>" }
 *
 * Success response data:
 *   {
 *     "tokenDataBase64": "<Base64-encoded raw token bytes>",
 *     "uuid": "<UUID string>"
 *   }
 *
 * The firmware team stores tokenDataBase64 (decoded to raw bytes) and uuid
 * in the device's secure flash memory (see Find My Network Accessory
 * Specification R2, §3.5).  Do NOT log or modify these values here.
 *
 * ⚠  SECURITY: This response is the only location where tokenData leaves
 *    this server.  It must travel over HTTPS in production.
 */

const { provisionDevice } = require('../services/token/provision.service');
const { sendSuccess, sendError, ERROR_CODES } = require('../utils/response');
const logger = require('../utils/logger');

async function provision(req, res, next) {
  try {
    const { deviceSerial } = req.body;

    // ── Input validation ─────────────────────────────────────────────────
    if (!deviceSerial || typeof deviceSerial !== 'string' || deviceSerial.trim() === '') {
      return sendError(
        res,
        400,
        ERROR_CODES.INVALID_INPUT,
        '"deviceSerial" is required and must be a non-empty string'
      );
    }

    const serial = deviceSerial.trim();

    // ── Provisioning logic ───────────────────────────────────────────────
    // provisionDevice() throws domain errors with .code set:
    //   DEVICE_ALREADY_PROVISIONED — serial already in DB
    //   TOKEN_POOL_EMPTY           — no VENDED tokens available
    const result = await provisionDevice(serial);

    // ── Response ─────────────────────────────────────────────────────────
    // tokenDataBase64 and uuid are sent directly to the device.
    // DO NOT log result.tokenDataBase64 — it contains raw token bytes.
    logger.info('[provision.controller] Provisioning successful', {
      deviceSerial: serial,
      uuid: result.uuid,
      // tokenDataBase64 intentionally excluded from log
    });

    return sendSuccess(
      res,
      200,
      {
        tokenDataBase64: result.tokenDataBase64,
        uuid:            result.uuid,
      },
      'Device provisioned successfully'
    );
  } catch (err) {
    // ── Domain error mapping ─────────────────────────────────────────────
    if (err.code === 'DEVICE_ALREADY_PROVISIONED') {
      return sendError(
        res,
        409,
        ERROR_CODES.DEVICE_ALREADY_PROVISIONED,
        'This device serial has already been provisioned'
      );
    }

    if (err.code === 'TOKEN_POOL_EMPTY') {
      return sendError(
        res,
        503,
        ERROR_CODES.TOKEN_POOL_EMPTY,
        'No tokens available — pull a new batch from Apple before provisioning'
      );
    }

    logger.error('[provision.controller] Unexpected error', { message: err.message });
    next(err);
  }
}

module.exports = { provision };

'use strict';

/**
 * provision.service.js
 * Core provisioning logic — the most security-critical path in this server.
 *
 * Implements the factory provisioning flow described in:
 *   "Apple MFi Introduction to Software Authentication" R4, §3.2.1
 *
 * What happens during provisioning:
 *   1. The flashing station calls POST /api/v1/provision with the device's
 *      serial number.
 *   2. This service queries MongoDB to confirm the serial has NOT been
 *      provisioned before (one-token-per-device, enforced strictly).
 *   3. It atomically claims the next available VENDED token.
 *   4. It writes deviceSerial, provisionedAt to the token record.
 *   5. It returns tokenData (Base64-encoded) and uuid to the caller so the
 *      device firmware can store them in secure flash memory.
 *
 * Format returned to device (per Find My Network Accessory Specification R2,
 * §3.5):
 *   The firmware expects tokenData as raw bytes (Base64-encoded in the JSON
 *   response) and uuid as a string.  Do NOT alter this encoding without
 *   confirming with the firmware team.
 *
 * Security rules:
 *   - DEVICE_ALREADY_PROVISIONED error if deviceSerial is found in any
 *     token document (regardless of status).
 *   - TOKEN_POOL_EMPTY error if no VENDED unprovisioned token exists.
 *   - The tokenData field in the response is the ONLY place tokenData is
 *     exposed — it is not logged anywhere.
 */

const Token = require('../../models/token.model');
const { TokenStatus } = require('../../config/constants');
const { PPID } = require('../../config/env');
const logger = require('../../utils/logger');

/**
 * Provisions a single token to a device identified by its serial number.
 *
 * This operation is atomic at the DB level: findOneAndUpdate with a filter
 * on { status, deviceSerial: null } ensures two concurrent requests for the
 * same (or different) devices cannot claim the same token.
 *
 * @param {string} deviceSerial - Hardware serial number of the device being
 *                                flashed.  Provided by the flashing station.
 * @returns {Promise<{ tokenDataBase64: string, uuid: string }>}
 *          tokenDataBase64 — raw token bytes, Base64-encoded for JSON transport
 *          uuid            — UUID string to store alongside tokenData on device
 *
 * @throws {{ code: 'DEVICE_ALREADY_PROVISIONED' }} if serial is already in DB.
 * @throws {{ code: 'TOKEN_POOL_EMPTY' }}            if no tokens are available.
 * @throws {Error}                                   on unexpected DB errors.
 */
async function provisionDevice(deviceSerial) {
  // ── Guard: reject already-provisioned devices ────────────────────────────
  const existing = await Token.findOne({ deviceSerial }).lean();

  if (existing) {
    logger.warn('[provision.service] Duplicate provisioning attempt rejected', {
      deviceSerial,
      existingUuid: existing.uuid,
      existingStatus: existing.status,
    });

    const err = new Error('Device has already been provisioned');
    err.code = 'DEVICE_ALREADY_PROVISIONED';
    throw err;
  }

  // ── Atomic claim: find next VENDED token and assign it ───────────────────
  // findOneAndUpdate is atomic at the document level in MongoDB.  The filter
  // on { status: VENDED, deviceSerial: null, ppid } ensures no two concurrent
  // requests can claim the same token.
  const token = await Token.findOneAndUpdate(
    {
      status:       TokenStatus.VENDED,
      deviceSerial: null,
      ppid:         PPID,
    },
    {
      $set: {
        deviceSerial,
        provisionedAt: new Date(),
        // Note: status stays VENDED until Apple registration completes.
        // See apple.register.js and token.service.markRegistered().
      },
    },
    { new: true }
  );

  if (!token) {
    logger.error('[provision.service] Token pool is empty — no VENDED tokens available', {
      ppid: PPID,
    });
    const err = new Error('Token pool is empty — pull a new batch from Apple');
    err.code = 'TOKEN_POOL_EMPTY';
    throw err;
  }

  logger.info('[provision.service] Token provisioned to device', {
    deviceSerial,
    uuid: token.uuid,
    // tokenData intentionally NOT logged. See logger.js redaction note.
  });

  // ── Return data in the format firmware expects ────────────────────────────
  // Per Find My Network Accessory Specification R2, §3.5:
  //   The device firmware stores tokenData as raw bytes and uuid as a string.
  //   We Base64-encode tokenData for safe JSON transport.
  //   The firmware team is responsible for decoding and storing them correctly.
  return {
    tokenDataBase64: token.tokenData.toString('base64'),
    uuid:            token.uuid,
  };
}

module.exports = { provisionDevice };

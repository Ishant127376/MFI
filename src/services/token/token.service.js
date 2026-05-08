'use strict';

/**
 * token.service.js
 * Business logic for token lifecycle management.
 *
 * Handles all MongoDB interactions related to token state transitions.
 * Apple API calls are delegated to the apple/ service layer (currently stubbed).
 *
 * Lifecycle transitions managed here:
 *   ALLOCATED → VENDED     (via pullAndStoreTokens)
 *   VENDED    → REGISTERED (via markRegistered)
 *   VENDED    → DESTROYED  (via destroyToken)
 *   * → REVOKED            (via markRevoked — triggered by Apple notification)
 *
 * The ACTIVATED transition is performed by Apple on their side following BLE
 * pairing; it is NOT triggered from this server.
 *
 * TODO [apple-spec-activation]: Determine how Apple notifies this server of
 *      activation events so the ACTIVATED state can be written to MongoDB.
 *      Requires the Apple Server Specification document.
 */

const Token = require('../../models/token.model');
const { TokenStatus } = require('../../config/constants');
const { PPID } = require('../../config/env');
const { pullTokensFromApple } = require('../apple/apple.tokens');
const logger = require('../../utils/logger');

/**
 * Calls Apple's token API to download a batch of tokens and persists them
 * to MongoDB with status VENDED.
 *
 * This function delegates the actual Apple API call to pullTokensFromApple()
 * which is currently a stub — it will throw NOT IMPLEMENTED.
 *
 * Once the stub is replaced with a real implementation, each token returned
 * by Apple (a { tokenData: Buffer, uuid: string } pair) is inserted into
 * the `tokens` collection with status VENDED and ppid set from .env.
 *
 * @returns {Promise<number>} Number of new token records inserted.
 * @throws {Error} Rethrows Apple API errors and DB errors after logging.
 */
async function pullAndStoreTokens() {
  // NOTE: This call currently throws NOT IMPLEMENTED (see apple.tokens.js).
  // Replace stub before calling this function end-to-end.
  const rawTokens = await pullTokensFromApple(PPID);

  // rawTokens is expected to be: Array<{ tokenData: Buffer, uuid: string }>
  // Field names to be confirmed once Apple Server Spec is received.
  // TODO [apple-spec-tokens-response]: Verify exact field names returned by
  //      Apple's API before mapping here.

  const docs = rawTokens.map((t) => ({
    tokenData:   t.tokenData,  // raw bytes — never logged (see logger.js)
    uuid:        t.uuid,
    ppid:        PPID,
    status:      TokenStatus.VENDED,
    provisionedAt: null,
    registeredAt:  null,
    activatedAt:   null,
    destroyedAt:   null,
    revokedAt:     null,
  }));

  const result = await Token.insertMany(docs, { ordered: false });
  logger.info('[token.service] Token batch stored', { count: result.length, ppid: PPID });
  return result.length;
}

/**
 * Returns the next available token for provisioning.
 * "Available" means: status === VENDED and deviceSerial === null.
 *
 * Uses findOneAndUpdate with an atomic status guard to prevent race conditions
 * in a concurrent factory environment (multiple flashing stations querying
 * simultaneously).
 *
 * @returns {Promise<import('../../models/token.model').default | null>}
 *          The reserved token document, or null if the pool is empty.
 */
async function claimNextAvailableToken() {
  // Atomic claim: find a VENDED, unprovisioned token and lock it in one step.
  // Status is temporarily unchanged here — provision.service.js sets
  // deviceSerial and provisionedAt in the same operation.
  const token = await Token.findOne({
    status:       TokenStatus.VENDED,
    deviceSerial: null,
    ppid:         PPID,
  }).lean();

  return token || null;
}

/**
 * Transitions a token to REGISTERED state after Apple's registration API
 * call completes.
 *
 * @param {string} uuid
 * @returns {Promise<import('../../models/token.model').default>}
 * @throws {Error} If no VENDED token with the given UUID exists.
 */
async function markRegistered(uuid) {
  const token = await Token.findOneAndUpdate(
    { uuid, status: TokenStatus.VENDED },
    { $set: { status: TokenStatus.REGISTERED, registeredAt: new Date() } },
    { new: true }
  );

  if (!token) {
    throw new Error(`[token.service] Cannot mark REGISTERED: no VENDED token found for uuid=${uuid}`);
  }

  logger.info('[token.service] Token marked REGISTERED', { uuid });
  return token;
}

/**
 * Transitions a token to DESTROYED state.
 * Only VENDED tokens that have not yet been provisioned can be destroyed.
 *
 * @param {string} uuid
 * @returns {Promise<import('../../models/token.model').default>}
 * @throws {Error} If no eligible token exists.
 */
async function destroyToken(uuid) {
  const token = await Token.findOneAndUpdate(
    { uuid, status: TokenStatus.VENDED, deviceSerial: null },
    { $set: { status: TokenStatus.DESTROYED, destroyedAt: new Date() } },
    { new: true }
  );

  if (!token) {
    throw new Error(
      `[token.service] Cannot destroy: no VENDED unprovisioned token found for uuid=${uuid}`
    );
  }

  logger.info('[token.service] Token destroyed', { uuid });
  return token;
}

/**
 * Marks a token as REVOKED.
 * Called when Apple notifies us that a token has been revoked.
 *
 * TODO [apple-spec-revocation]: Determine the mechanism by which Apple notifies
 *      this server of revoked tokens (webhook? polling? push?).
 *      Implement the corresponding endpoint/handler once known.
 *
 * @param {string} uuid
 * @returns {Promise<import('../../models/token.model').default>}
 */
async function markRevoked(uuid) {
  const token = await Token.findOneAndUpdate(
    { uuid },
    { $set: { status: TokenStatus.REVOKED, revokedAt: new Date() } },
    { new: true }
  );

  if (!token) {
    throw new Error(`[token.service] Cannot mark REVOKED: no token found for uuid=${uuid}`);
  }

  logger.warn('[token.service] Token marked REVOKED', { uuid });
  return token;
}

/**
 * Returns a status-keyed count of all tokens in the database for the
 * configured PPID.  Used by GET /api/v1/tokens/stats.
 *
 * @returns {Promise<Record<string, number>>}
 *   e.g. { ALLOCATED: 0, VENDED: 983, REGISTERED: 12, ACTIVATED: 5, ... }
 */
async function getTokenStats() {
  const pipeline = [
    { $match: { ppid: PPID } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ];

  const rows = await Token.aggregate(pipeline);

  // Initialise all statuses to 0 so the response structure is always complete.
  const stats = Object.fromEntries(
    Object.values(TokenStatus).map((s) => [s, 0])
  );

  for (const row of rows) {
    stats[row._id] = row.count;
  }

  return stats;
}

module.exports = {
  pullAndStoreTokens,
  claimNextAvailableToken,
  markRegistered,
  destroyToken,
  markRevoked,
  getTokenStats,
};

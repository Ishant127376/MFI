'use strict';

/**
 * constants.js
 * TokenStatus enum representing every state a software authentication token
 * can occupy throughout its lifecycle.
 *
 * Lifecycle (per Apple MFi "Introduction to Software Authentication" R4, §2):
 *
 *   ALLOCATED  → Token exists in Apple's system; not yet downloaded by OES server.
 *   VENDED     → OES server fetched the token from Apple's token API.
 *   REGISTERED → OES server called Apple's registration API; Apple knows this
 *                UUID is bound to a physical OES device.
 *   ACTIVATED  → Apple confirmed pairing between the device and an iPhone
 *                (happens on Apple's side via BLE — NOT handled by this server).
 *   DESTROYED  → OES explicitly destroyed an unused/vended token.
 *   REVOKED    → Apple revoked the token from their side.
 *
 * All values are strings so they can be stored directly in MongoDB and compared
 * without an additional mapping step.
 *
 * No numeric values are hardcoded here.  Do not add sample serial numbers,
 * UUIDs, or token bytes to this file.
 */

const TokenStatus = Object.freeze({
  ALLOCATED:  'ALLOCATED',
  VENDED:     'VENDED',
  REGISTERED: 'REGISTERED',
  ACTIVATED:  'ACTIVATED',
  DESTROYED:  'DESTROYED',
  REVOKED:    'REVOKED',
});

module.exports = { TokenStatus };

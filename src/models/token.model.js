'use strict';

/**
 * token.model.js
 * Mongoose schema + model for Apple MFi software authentication tokens.
 *
 * Field design references:
 *   - Apple MFi "Introduction to Software Authentication" R4, §2 (lifecycle)
 *   - Apple MFi "Introduction to Software Authentication" R4, §3.2.1 (provisioning)
 *   - Apple MFi "Introduction to Software Authentication" R4, §3.3 (registration)
 *   - Find My Network Accessory Specification R2, §3.5 (device provisioning format)
 *
 * ─── SECURITY NOTE ─────────────────────────────────────────────────────────
 *   The `tokenData` field contains raw cryptographic token bytes received from
 *   Apple.  It MUST NEVER appear in any log output, error message, HTTP response
 *   body (other than the one controlled /provision delivery), or debug dump.
 *   This is enforced in logger.js via a log-level transform.
 * ───────────────────────────────────────────────────────────────────────────
 */

const mongoose = require('mongoose');
const { TokenStatus } = require('../config/constants');

const tokenSchema = new mongoose.Schema(
  {
    /**
     * Raw cryptographic token bytes as received from Apple's token API.
     * Format details unknown until the Apple Software Token Authentication
     * Server Specification is received from the MFi Portal.
     *
     * Stored as Buffer (binary) to preserve byte-exact fidelity.
     *
     * ⚠  NEVER log this field.  See logger.js redaction rule.
     */
    tokenData: {
      type: Buffer,
      required: true,
    },

    /**
     * OES-generated pseudo-accessory UUID (RFC 4122).
     * This value is assigned later during provisioning, not at token pull time.
     */
    uuid: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
    },

    /**
     * Apple TOKEN_ID from CSV (auth entity identifier).
     * Must be unique for each token record.
     */
    tokenId: {
      type: String,
      required: true,
      unique: true,
    },

    /**
     * Product Plan ID under which this token was issued.
     * Must match the PPID environment variable.  Never hardcoded.
     * Confirmed via Apple MFi Portal.
     */
    ppid: {
      type: String,
      required: true,
    },

    /**
     * Current lifecycle state of this token.
     * Transitions:  ALLOCATED → VENDED → REGISTERED → ACTIVATED
     *                              ↘ DESTROYED
     *                              ↘ REVOKED (by Apple)
     * See constants.js for full enum definitions.
     */
    status: {
      type: String,
      enum: Object.values(TokenStatus),
      default: TokenStatus.ALLOCATED,
    },

    /**
     * Serial number of the physical OES device this token was provisioned to.
     * Populated by the /provision endpoint.
     * Null until provisioning occurs.
     * Used for duplicate-provisioning rejection (DEVICE_ALREADY_PROVISIONED).
     */
    deviceSerial: {
      type: String,
      default: null,
    },

    /** Timestamp when the token was vended to a device via /provision. */
    provisionedAt: {
      type: Date,
      default: null,
    },

    /**
     * Timestamp when OES server registered this UUID with Apple.
     * Set by the /register flow (apple.register.js — currently STUB).
     */
    registeredAt: {
      type: Date,
      default: null,
    },

    /**
     * Timestamp when Apple confirmed BLE pairing (ACTIVATED state).
     * This value is set by an Apple-initiated callback or webhook —
     * exact mechanism unknown until Apple server spec is received.
     *
     * TODO [apple-spec]: Determine how Apple notifies the server of activation
     *      events.  Populate this field once that mechanism is known.
     */
    activatedAt: {
      type: Date,
      default: null,
    },

    /** Timestamp when the token was explicitly destroyed by OES. */
    destroyedAt: {
      type: Date,
      default: null,
    },

    /** Timestamp when Apple revoked the token. */
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  {
    /**
     * Adds `createdAt` and `updatedAt` fields automatically.
     * `createdAt` reflects when the token record was first inserted
     * (i.e. when it was downloaded from Apple).
     */
    timestamps: true,
    collection: 'tokens', // explicit collection name for MongoDB Compass clarity
  }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

// uuid is already uniquely indexed via `unique: true` in the field definition.
// Additional compound index for the most common provisioning query:
tokenSchema.index({ status: 1, ppid: 1 });
// Fast duplicate-serial lookups:
tokenSchema.index({ deviceSerial: 1 });

// ─── Model ───────────────────────────────────────────────────────────────────

const Token = mongoose.model('Token', tokenSchema);

module.exports = Token;

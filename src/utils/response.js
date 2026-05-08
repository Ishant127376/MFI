'use strict';

/**
 * response.js
 * Utility helpers for constructing standardised JSON responses.
 *
 * All HTTP responses from this server follow one of two shapes:
 *
 *   Success:  { success: true,  data: <object>,  message: <string> }
 *   Error:    { success: false, error: { code: <string>, message: <string> } }
 *
 * Error codes are defined in the ERROR_CODES object below and must match the
 * codes documented in README.md.  Do not use ad-hoc string literals in
 * controllers — always reference ERROR_CODES.
 */

// ─── Error codes ─────────────────────────────────────────────────────────────

const ERROR_CODES = Object.freeze({
  TOKEN_POOL_EMPTY:           'TOKEN_POOL_EMPTY',
  DEVICE_ALREADY_PROVISIONED: 'DEVICE_ALREADY_PROVISIONED',
  INVALID_API_KEY:            'INVALID_API_KEY',
  APPLE_API_UNAVAILABLE:      'APPLE_API_UNAVAILABLE',
  REGISTRATION_FAILED:        'REGISTRATION_FAILED',
  DB_ERROR:                   'DB_ERROR',
  INVALID_INPUT:              'INVALID_INPUT',
  NOT_IMPLEMENTED:            'NOT_IMPLEMENTED',
});

// ─── Response builders ───────────────────────────────────────────────────────

/**
 * Send a successful response.
 *
 * @param {import('express').Response} res
 * @param {number}  statusCode  - HTTP status code (default 200)
 * @param {object}  data        - Payload to include under the `data` key
 * @param {string}  message     - Human-readable success message
 */
function sendSuccess(res, statusCode = 200, data = {}, message = '') {
  return res.status(statusCode).json({
    success: true,
    data,
    message,
  });
}

/**
 * Send an error response.
 *
 * @param {import('express').Response} res
 * @param {number}  statusCode  - HTTP status code
 * @param {string}  code        - Machine-readable error code (use ERROR_CODES)
 * @param {string}  message     - Human-readable error message
 */
function sendError(res, statusCode, code, message) {
  return res.status(statusCode).json({
    success: false,
    error: { code, message },
  });
}

module.exports = { sendSuccess, sendError, ERROR_CODES };

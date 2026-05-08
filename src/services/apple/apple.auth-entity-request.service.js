'use strict';

/**
 * apple.auth-entity-request.service.js
 * Calls Apple MFi Software Authentication endpoint to request auth entities.
 *
 * API:
 *   POST https://swa.apple.com/api/v1.0/external/authEntityRequests
 *
 * Environment variables used:
 *   - APPLE_PPID
 *   - TOKEN_REQUEST_COUNT
 */

const https = require('https');
const { appleHttpsAgent } = require('./apple.https-agent');
const logger = require('../../utils/logger');

const APPLE_HOST = 'swa.apple.com';
const APPLE_PATH = '/api/v1.0/external/authEntityRequests';
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Parse and validate request count as a positive integer.
 *
 * @param {unknown} value
 * @returns {number}
 * @throws {Error}
 */
function toPositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('TOKEN_REQUEST_COUNT must be a positive integer.');
  }
  return parsed;
}

/**
 * Parse JSON safely.
 *
 * @param {string} text
 * @returns {object|null}
 */
function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

/**
 * Build Apple request payload from environment variables.
 *
 * @returns {{ ppid: string, requested_auth_entity_count: number }}
 * @throws {Error}
 */
function buildPayloadFromEnv() {
  const ppid = (process.env.APPLE_PPID || '').trim();
  if (!ppid) {
    throw new Error('APPLE_PPID is required.');
  }

  const requestedAuthEntityCount = toPositiveInt(process.env.TOKEN_REQUEST_COUNT);

  return {
    ppid,
    requested_auth_entity_count: requestedAuthEntityCount,
  };
}

/**
 * Request auth entities from Apple using mTLS over Node's built-in https.
 *
 * - Sends JSON request body
 * - Parses JSON response
 * - Handles network errors and non-2xx HTTP responses
 * - Logs only non-sensitive fields (request_id, status)
 *
 * @returns {Promise<object>} Parsed JSON response from Apple
 */
function requestAuthEntities() {
  const payload = buildPayloadFromEnv();
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host: APPLE_HOST,
        path: APPLE_PATH,
        method: 'POST',
        agent: appleHttpsAgent,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks = [];

        // Accumulate response body chunks before parsing JSON.
        response.on('data', (chunk) => chunks.push(chunk));

        response.on('end', () => {
          const responseText = Buffer.concat(chunks).toString('utf8');
          const parsed = tryParseJson(responseText);
          const status = response.statusCode || 0;
          const requestId = parsed && parsed.request_id ? String(parsed.request_id) : undefined;

          // Log only non-sensitive request metadata.
          logger.info('Apple authEntityRequests response', {
            request_id: requestId,
            status,
          });

          if (status < 200 || status >= 300) {
            const error = new Error(`Apple API returned non-success status: ${status}`);
            error.code = 'APPLE_NON_2XX';
            error.status = status;
            error.request_id = requestId;
            error.response = parsed || responseText;
            return reject(error);
          }

          if (!parsed) {
            const error = new Error('Apple API returned non-JSON response body.');
            error.code = 'APPLE_INVALID_JSON';
            error.status = status;
            error.request_id = requestId;
            return reject(error);
          }

          return resolve(parsed);
        });
      }
    );

    // Handle request timeout as a network-class error.
    request.on('timeout', () => {
      request.destroy(new Error('Apple API request timed out.'));
    });

    // Handle DNS/TLS/socket and other network-layer errors.
    request.on('error', (err) => {
      const error = new Error(`Apple API network error: ${err.message}`);
      error.code = 'APPLE_NETWORK_ERROR';
      return reject(error);
    });

    // Send JSON body and flush request.
    request.write(body);
    request.end();
  });
}

module.exports = {
  requestAuthEntities,
};

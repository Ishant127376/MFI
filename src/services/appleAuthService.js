'use strict';

/**
 * appleAuthService.js
 *
 * Local testing service for Apple MFi Software Authentication token requests.
 * Uses Node's built-in https module with mutual TLS (mTLS).
 *
 * Security:
 * - Never logs certificate/private key contents.
 * - Logs only non-sensitive metadata (status and request_id when available).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const APPLE_API_URL = 'https://swa.apple.com/api/v1.0/external/authEntityRequests';
const REQUEST_TIMEOUT_MS = 30000;

// Resolve certificate file paths from repository root.
const CERT_PATH = path.resolve(__dirname, '../../certs/server_cert.pem');
const KEY_PATH = path.resolve(__dirname, '../../certs/key.pem');

/**
 * Build a safe error object with a stable error code and optional metadata.
 *
 * @param {string} code - Machine-readable error code.
 * @param {string} message - Human-readable error message.
 * @param {object} [meta] - Optional metadata.
 * @returns {Error}
 */
function createError(code, message, meta) {
  const error = new Error(message);
  error.code = code;

  if (meta && typeof meta === 'object') {
    Object.assign(error, meta);
  }

  return error;
}

/**
 * Parse a value as a positive integer for TOKEN_REQUEST_COUNT.
 *
 * @param {string|undefined} value
 * @returns {number}
 */
function parsePositiveInt(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createError(
      'INVALID_TOKEN_REQUEST_COUNT',
      'TOKEN_REQUEST_COUNT must be a positive integer.'
    );
  }

  return parsed;
}

/**
 * Load certificate and key from disk for mTLS.
 *
 * @returns {{ cert: Buffer, key: Buffer }}
 */
function loadMtlsCredentials() {
  try {
    return {
      cert: fs.readFileSync(CERT_PATH),
      key: fs.readFileSync(KEY_PATH),
    };
  } catch (error) {
    throw createError(
      'TLS_CREDENTIAL_LOAD_FAILED',
      'Failed to load mTLS certificate or private key from certs folder.',
      { cause: error.message }
    );
  }
}

/**
 * Build Apple API request payload from environment variables.
 *
 * @returns {{ ppid: string, requested_auth_entity_count: number }}
 */
function buildPayloadFromEnv() {
  const ppid = (process.env.APPLE_PPID || '').trim();

  if (!ppid) {
    throw createError('MISSING_APPLE_PPID', 'APPLE_PPID is required.');
  }

  return {
    ppid,
    requested_auth_entity_count: parsePositiveInt(process.env.TOKEN_REQUEST_COUNT),
  };
}

/**
 * Request Apple auth entities using mTLS and return parsed JSON response.
 *
 * Handles:
 * - response stream collection
 * - JSON parsing
 * - non-2xx status handling
 * - timeout
 * - network/TLS errors
 *
 * @returns {Promise<{ statusCode: number, data: object }>} Parsed response wrapper.
 */
function requestAuthTokens() {
  const payload = buildPayloadFromEnv();
  const requestBody = JSON.stringify(payload);
  const { cert, key } = loadMtlsCredentials();
  const endpoint = new URL(APPLE_API_URL);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        path: endpoint.pathname,
        method: 'POST',

        // mTLS setup.
        cert,
        key,
        rejectUnauthorized: true,

        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      },
      (res) => {
        const chunks = [];

        res.on('data', (chunk) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          const statusCode = res.statusCode || 0;
          const rawBody = Buffer.concat(chunks).toString('utf8');

          let parsedBody;
          try {
            parsedBody = JSON.parse(rawBody);
          } catch (parseError) {
            return reject(
              createError(
                'JSON_PARSE_ERROR',
                'Apple API returned non-JSON response.',
                {
                  statusCode,
                  parseCause: parseError.message,
                }
              )
            );
          }

          const requestId =
            parsedBody && parsedBody.request_id ? String(parsedBody.request_id) : undefined;

          // Log only non-sensitive fields.
          console.log('[AppleAuth] Response received', {
            statusCode,
            request_id: requestId,
          });

          if (statusCode < 200 || statusCode >= 300) {
            return reject(
              createError(
                'APPLE_NON_2XX',
                `Apple API request failed with status ${statusCode}.`,
                {
                  statusCode,
                  request_id: requestId,
                  response: parsedBody,
                }
              )
            );
          }

          return resolve({
            statusCode,
            data: parsedBody,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(createError('REQUEST_TIMEOUT', 'Apple API request timed out.'));
    });

    req.on('error', (error) => {
      // Detect common TLS-related errors and label them explicitly.
      const tlsErrorCodes = new Set([
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'CERT_HAS_EXPIRED',
        'ERR_TLS_CERT_ALTNAME_INVALID',
        'ECONNRESET',
      ]);

      const isTlsError =
        tlsErrorCodes.has(error.code) ||
        String(error.message || '').toLowerCase().includes('tls') ||
        String(error.message || '').toLowerCase().includes('certificate');

      if (isTlsError) {
        return reject(
          createError('TLS_ERROR', `TLS handshake/certificate error: ${error.message}`, {
            causeCode: error.code,
          })
        );
      }

      if (error.code === 'REQUEST_TIMEOUT') {
        return reject(error);
      }

      return reject(
        createError('REQUEST_ERROR', `HTTPS request error: ${error.message}`, {
          causeCode: error.code,
        })
      );
    });

    req.write(requestBody);
    req.end();
  });
}

module.exports = {
  requestAuthTokens,
};

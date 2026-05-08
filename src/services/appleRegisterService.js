'use strict';

/**
 * appleRegisterService.js
 *
 * Registers a single used Apple MFi software auth token.
 * This operation is irreversible on Apple side.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');

const REGISTER_URL = 'https://swa.apple.com/api/v1.0/external/authEntities/register';
const BULK_REGISTER_URL = 'https://swa.apple.com/api/v1.0/external/bulk/usedAuthEntities';
const REQUEST_TIMEOUT_MS = 10000;
const PPID = '344406-296965';
const USER_AGENT = 'MyCompany/NodeBackend/1.0';

const CERT_PATH = path.resolve(__dirname, '../../certs/server_cert.pem');
const KEY_PATH = path.resolve(__dirname, '../../certs/key.pem');

function createMtlsAgent() {
  const cert = fs.readFileSync(CERT_PATH);
  const key = fs.readFileSync(KEY_PATH);

  return new https.Agent({
    cert,
    key,
    rejectUnauthorized: true,
  });
}

/**
 * Register exactly one token with Apple.
 *
 * @param {string} tokenId
 * @param {string} requestId
 * @returns {Promise<object>} Apple response.data
 */
async function registerToken(tokenId, requestId) {
  if (tokenId === undefined || tokenId === null || String(tokenId).trim() === '') {
    throw new Error('tokenId is required for registration');
  }

  if (requestId === undefined || requestId === null || String(requestId).trim() === '') {
    throw new Error('requestId is required for registration');
  }

  // Safety guard: do not allow arrays/batches for this irreversible endpoint.
  if (Array.isArray(tokenId)) {
    throw new Error('Only one tokenId is allowed per registration request');
  }

  if (Array.isArray(requestId)) {
    throw new Error('Only one requestId is allowed per registration request');
  }

  const normalizedTokenId = String(tokenId).trim();
  const normalizedRequestId = String(requestId).trim();
  // In-field registration uses a single UUID mapping for a single token call.
  const generatedUuid = '00000000-0000-0000-0000-000000000001';

  // Safety guard for accidental comma-separated values (batch-like input).
  if (normalizedTokenId.includes(',')) {
    throw new Error('Only one tokenId is allowed per registration request');
  }

  if (normalizedRequestId.includes(',')) {
    throw new Error('Only one requestId is allowed per registration request');
  }

  console.log('⚠️ Registering ONE token (irreversible):', normalizedTokenId);
  console.log('Request ID:', normalizedRequestId);
  console.log('Token:', normalizedTokenId);
  console.log('UUID:', generatedUuid);

  const requestHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
  };

  console.log('Registration request headers:', requestHeaders);

  try {
    const response = await axios.post(
      REGISTER_URL,
      {
        ppid: PPID,
        request_id: normalizedRequestId,
        auth_entities: [
          {
            auth_entity_id: normalizedTokenId,
            uuid: generatedUuid,
          },
        ],
      },
      {
        httpsAgent: createMtlsAgent(),
        timeout: REQUEST_TIMEOUT_MS,
        headers: requestHeaders,
      }
    );

    console.log('Registration response headers:', response.headers);
    console.log('Registration response data:', response.data);

    const contentType = String(response.headers && response.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('text/html')) {
      console.error('ERROR: Wrong endpoint or server (received HTML instead of JSON)');
    }

    return response.data;
  } catch (error) {
    const errorCode = error && error.response && error.response.data && error.response.data.error_code;
    if (errorCode === 'EXT_SVC_1003') {
      console.warn('Primary register endpoint returned INVALID_REQUEST_ID. Retrying with usedAuthEntities format for single token.');

      const authEntityObject = {
        [normalizedTokenId]: generatedUuid,
      };

      const fallbackResponse = await axios.post(
        BULK_REGISTER_URL,
        {
          ppid: PPID,
          auth_entities: [authEntityObject],
        },
        {
          httpsAgent: createMtlsAgent(),
          timeout: REQUEST_TIMEOUT_MS,
          headers: requestHeaders,
        }
      );

      console.log('Fallback registration response headers:', fallbackResponse.headers);
      console.log('Fallback registration response data:', fallbackResponse.data);
      return fallbackResponse.data;
    }

    if (error.response) {
      console.error('Registration failed with HTTP status:', error.response.status);
      console.error('Registration error response headers:', error.response.headers);
      console.error('Error response data:', error.response.data);

      const contentType = String(error.response.headers && error.response.headers['content-type'] || '').toLowerCase();
      if (contentType.includes('text/html')) {
        console.error('ERROR: Wrong endpoint or server (received HTML instead of JSON)');
      }

      throw error;
    }

    if (error.request) {
      console.error('Network error during token registration:', error.message);
      throw error;
    }

    console.error('Registration error:', error.message);
    throw error;
  }
}

/**
 * Check Apple registration status/details for a given request ID.
 *
 * @param {string} requestId
 * @returns {Promise<object>} Apple response.data
 */
async function checkRegistrationStatus(requestId) {
  if (requestId === undefined || requestId === null || String(requestId).trim() === '') {
    throw new Error('requestId is required to check registration status');
  }

  if (Array.isArray(requestId)) {
    throw new Error('Only one requestId is allowed per status check');
  }

  const normalizedRequestId = String(requestId).trim();
  console.log('Checking status for request_id:', normalizedRequestId);

  const requestHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
  };

  try {
    const response = await axios.get(
      `https://swa.apple.com/api/v1.0/external/authEntities/${encodeURIComponent(normalizedRequestId)}`,
      {
        httpsAgent: createMtlsAgent(),
        timeout: REQUEST_TIMEOUT_MS,
        headers: requestHeaders,
      }
    );

    console.log('Status response:', response.data);
    return response.data;
  } catch (error) {
    if (error.response) {
      console.error('Status check failed with HTTP status:', error.response.status);
      console.error('Status check error response data:', error.response.data);
      throw error;
    }

    if (error.request) {
      console.error('Network error during status check:', error.message);
      throw error;
    }

    console.error('Status check error:', error.message);
    throw error;
  }
}

module.exports = {
  registerToken,
  checkRegistrationStatus,
};

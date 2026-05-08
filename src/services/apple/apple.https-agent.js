'use strict';

/**
 * apple.https-agent.js
 * Reusable HTTPS agent configured for Apple mTLS calls.
 *
 * Security notes:
 * - Certificate/key contents are read from disk and never logged.
 * - Paths are fixed to the local certs/ directory as required.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Resolve certificate locations relative to repository root.
const CERT_PATH = path.resolve(__dirname, '../../../certs/server_cert.pem');
const KEY_PATH = path.resolve(__dirname, '../../../certs/key.pem');

/**
 * Build a configured https.Agent for mutual TLS.
 *
 * @returns {https.Agent}
 * @throws {Error} If certificate files are missing/unreadable.
 */
function createAppleMtlsAgent() {
  // Load certificate material synchronously at startup for fail-fast behavior.
  const cert = fs.readFileSync(CERT_PATH);
  const key = fs.readFileSync(KEY_PATH);

  return new https.Agent({
    cert,
    key,
    // Keep strict TLS verification enabled for production safety.
    rejectUnauthorized: true,
    keepAlive: true,
    maxSockets: 20,
  });
}

// Export a shared, pre-configured agent instance for reuse across requests.
const appleHttpsAgent = createAppleMtlsAgent();

module.exports = {
  appleHttpsAgent,
  createAppleMtlsAgent,
};

'use strict';

/**
 * env.js
 * Loads and validates all required environment variables at startup.
 * The server will refuse to start if any required variable is missing or empty.
 *
 * All Apple-specific values (PPID, APPLE_CERT_PATH) are treated as opaque
 * strings — this module does NOT interpret them.
 */

require('dotenv').config();

const REQUIRED_VARS = [
  'MONGODB_URI',
  'PORT',
  'NODE_ENV',
  'APPLE_CERT_PATH',
  'PPID',
  'ADMIN_API_KEY',
  'DEVICE_API_KEY',
];

function validateEnv() {
  const missing = [];

  for (const key of REQUIRED_VARS) {
    const value = process.env[key];
    if (value === undefined || value.trim() === '') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[env] Server startup aborted. The following required environment variables ` +
      `are missing or empty:\n  ${missing.join('\n  ')}\n` +
      `Copy .env.example → .env and fill in every value.`
    );
  }
}

validateEnv();

module.exports = {
  MONGODB_URI:    process.env.MONGODB_URI.trim(),
  PORT:           parseInt(process.env.PORT.trim(), 10),
  NODE_ENV:       process.env.NODE_ENV.trim(),
  APPLE_CERT_PATH: process.env.APPLE_CERT_PATH.trim(),
  PPID:           process.env.PPID.trim(),
  ADMIN_API_KEY:  process.env.ADMIN_API_KEY.trim(),
  DEVICE_API_KEY: process.env.DEVICE_API_KEY.trim(),
};

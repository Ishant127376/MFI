'use strict';

/**
 * logger.js
 * Structured application logger backed by Winston.
 *
 * ─── CRITICAL SECURITY RULE ────────────────────────────────────────────────
 *   The `tokenData` field contains raw Apple MFi cryptographic token bytes.
 *   It MUST NEVER appear in any log output.
 *   A custom format transform (redactSensitiveFields) removes this field from
 *   every log message before it is written to any transport.
 * ───────────────────────────────────────────────────────────────────────────
 */

const winston = require('winston');
const { NODE_ENV } = require('../config/env');

/**
 * Recursively scrubs cryptographically sensitive fields from a plain object
 * before it reaches any Winston transport.
 *
 * Fields scrubbed:
 *   - tokenData  (raw Apple token bytes — the primary sensitive value)
 *
 * This is intentionally conservative: it mutates a *clone* of the metadata
 * object rather than the original so the caller's data is unchanged.
 *
 * @param {object} obj
 * @returns {object}
 */
function scrubSensitiveFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  const clone = Array.isArray(obj) ? [...obj] : { ...obj };

  for (const key of Object.keys(clone)) {
    if (key === 'tokenData') {
      clone[key] = '[REDACTED — tokenData must never be logged]';
    } else if (typeof clone[key] === 'object' && clone[key] !== null) {
      clone[key] = scrubSensitiveFields(clone[key]);
    }
  }

  return clone;
}

const redactSensitiveFields = winston.format((info) => {
  const scrubbed = scrubSensitiveFields(info);
  return Object.assign(info, scrubbed);
});

// ─── Formats ─────────────────────────────────────────────────────────────────

const developmentFormat = winston.format.combine(
  redactSensitiveFields(),
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}] ${message}${metaStr}`;
  })
);

const productionFormat = winston.format.combine(
  redactSensitiveFields(),
  winston.format.timestamp(),
  winston.format.json()
);

// ─── Transports ──────────────────────────────────────────────────────────────

const transports = [new winston.transports.Console()];

// In production, also write to files.
if (NODE_ENV === 'production') {
  transports.push(
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  );
}

// ─── Logger instance ─────────────────────────────────────────────────────────

const logger = winston.createLogger({
  level: NODE_ENV === 'production' ? 'info' : 'debug',
  format: NODE_ENV === 'production' ? productionFormat : developmentFormat,
  transports,
});

module.exports = logger;

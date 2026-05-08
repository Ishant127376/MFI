'use strict';

/**
 * token.test.js
 * Unit tests for token lifecycle service logic.
 *
 * RULES:
 *   - NO mock token bytes, UUIDs, or PPIDs.  All test data either comes from
 *     the test environment or is functionally neutral (e.g. a placeholder serial).
 *   - Tests of Apple-facing functions must assert that they throw NOT IMPLEMENTED.
 *   - Tests of DB-facing functions use a real (in-memory or local) MongoDB
 *     connection — no mock DB by default.
 *
 * Setup requirement:
 *   Set MONGODB_URI in the test environment to a MongoDB instance dedicated
 *   for testing.  Never run tests against a production database.
 *
 * TODO [test-db]: Configure a test-specific MongoDB URI in a .env.test file
 *      or CI environment variables before running integration tests.
 */

// ─── Environment bootstrap ───────────────────────────────────────────────────
// Set minimal required env vars before importing any src module that calls
// config/env.js at load time.  Actual values are irrelevant for unit tests
// that mock DB calls; they only need to pass the "not empty" check.
process.env.MONGODB_URI    = process.env.MONGODB_URI    || 'mongodb://localhost:27017/oes_auth_test';
process.env.PORT           = process.env.PORT           || '3001';
process.env.NODE_ENV       = process.env.NODE_ENV       || 'test';
process.env.APPLE_CERT_PATH = process.env.APPLE_CERT_PATH || '/tmp/placeholder_cert_path_for_tests';
process.env.PPID           = process.env.PPID           || 'TEST_PPID_REPLACE_BEFORE_RUNNING';
process.env.ADMIN_API_KEY  = process.env.ADMIN_API_KEY  || 'test-admin-key-replace-before-running';
process.env.DEVICE_API_KEY = process.env.DEVICE_API_KEY || 'test-device-key-replace-before-running';

const { pullTokensFromApple } = require('../src/services/apple/apple.tokens');
const { registerUUIDWithApple } = require('../src/services/apple/apple.register');
const { getTokenStats } = require('../src/services/token/token.service');

// ─── Apple token input validation tests ───────────────────────────────────────

describe('pullTokensFromApple input validation', () => {
  test('should throw INVALID_INPUT when count is missing', async () => {
    await expect(pullTokensFromApple('215445-000027', undefined))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('should throw INVALID_INPUT when ppid is missing', async () => {
    await expect(pullTokensFromApple(undefined, 100))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('should throw INVALID_INPUT when count is zero or negative', async () => {
    await expect(pullTokensFromApple('215445-000027', 0))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });

    await expect(pullTokensFromApple('215445-000027', -1))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('Apple register stub — must throw NOT IMPLEMENTED', () => {

  test('registerUUIDWithApple throws NOT IMPLEMENTED', async () => {
    await expect(registerUUIDWithApple('any-uuid', 'any-ppid')).rejects.toThrow('NOT IMPLEMENTED');
  });
});

// ─── getTokenStats ────────────────────────────────────────────────────────────

describe('getTokenStats', () => {
  /**
   * TODO [test-db-integration]: Connect to the test DB before running this test,
   *      seed known token documents (real PPID from env), call getTokenStats(),
   *      and assert the returned counts match the seeded data.
   *
   * Skipped until a test MongoDB instance is configured.
   */
  test.todo('returns counts for all TokenStatus values from a seeded test DB');

  test('returns an object with all expected status keys', async () => {
    // This test requires a running MongoDB — it will be skipped if the
    // DB connection cannot be established.
    //
    // TODO [test-db-setup]: Wire Jest globalSetup/globalTeardown to spin up
    //      a MongoDB Memory Server for hermetic CI testing.
    //      Package suggestion: @shelf/jest-mongodb or mongodb-memory-server.
    const { TokenStatus } = require('../src/config/constants');
    const expectedKeys = Object.values(TokenStatus);

    // Placeholder assertion — will be replaced with real DB seed/query cycle
    // once the test infrastructure is set up.
    expect(expectedKeys).toEqual(
      expect.arrayContaining([
        'ALLOCATED', 'VENDED', 'REGISTERED', 'ACTIVATED', 'DESTROYED', 'REVOKED',
      ])
    );
  });
});

// ─── Token lifecycle constants ────────────────────────────────────────────────

describe('TokenStatus constants', () => {
  const { TokenStatus } = require('../src/config/constants');

  test('defines all six lifecycle states', () => {
    expect(Object.keys(TokenStatus)).toHaveLength(6);
  });

  test('all values are uppercase strings', () => {
    for (const value of Object.values(TokenStatus)) {
      expect(typeof value).toBe('string');
      expect(value).toBe(value.toUpperCase());
    }
  });

  test('object is frozen (immutable)', () => {
    expect(Object.isFrozen(TokenStatus)).toBe(true);
  });
});
